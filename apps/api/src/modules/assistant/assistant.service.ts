import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assistantOutputByType,
  type AssistantSuggestion,
  type AssistantSuggestionOutput,
  type CreateAssistantSuggestion,
  type DailyPlanSuggestionOutput,
  type EditAssistantSuggestion,
  type RejectAssistantSuggestion,
  type TaskDecompositionOutput,
  type TaskExtractionOutput,
  type CarryoverDiagnosisOutput,
  type OutcomeSummaryOutput,
} from '@execution/contracts';
import { createHash } from 'node:crypto';
import type { z } from 'zod';

import { AppConfig } from '../../config/app-config.service';
import { OperationalMetrics } from '../../common/observability/operational-metrics.service';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { type Clock, CLOCK } from '../auth/clock';
import { DailyPlansService } from '../daily-plans/daily-plans.service';
import { InvalidationStreamService } from '../invalidations/invalidation-stream.service';
import { ReviewsService } from '../reviews/reviews.service';
import { TasksService } from '../tasks/tasks.service';
import { AssistantContextService } from './assistant-context.service';
import { ASSISTANT_PROMPTS } from './assistant-prompts';
import { AssistantRateLimiter } from './assistant-rate-limiter';
import { AssistantSemanticValidator } from './assistant-semantic-validator';
import { toAssistantSuggestionContract } from './assistant-presenter';
import {
  type LlmProvider,
  type LlmProviderResult,
  LLM_PROVIDER,
} from './llm-provider';

export interface AssistantProcessResult {
  completed: boolean;
  retryable: boolean;
  errorCode: string | null;
}

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly contexts: AssistantContextService,
    private readonly semanticValidator: AssistantSemanticValidator,
    private readonly rateLimiter: AssistantRateLimiter,
    private readonly tasks: TasksService,
    private readonly dailyPlans: DailyPlansService,
    private readonly reviews: ReviewsService,
    private readonly invalidations: InvalidationStreamService,
    private readonly metrics: OperationalMetrics,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
  ) {}

  async create(
    userId: string,
    request: CreateAssistantSuggestion,
  ): Promise<AssistantSuggestion> {
    if (request.idempotencyKey) {
      const existing = await this.prisma.aiSuggestion.findUnique({
        where: {
          userId_type_idempotencyKey: {
            userId,
            type: request.type,
            idempotencyKey: request.idempotencyKey,
          },
        },
      });
      if (existing) return toAssistantSuggestionContract(existing);
    }

    const context = await this.contexts.build(userId, request);
    const prompt = ASSISTANT_PROMPTS[request.type];
    const asynchronous = ['daily_plan', 'outcome_summary'].includes(
      request.type,
    );
    const now = this.clock.now();
    const expiresAt = new Date(
      now.getTime() + this.config.assistantRetentionDays * 86_400_000,
    );
    const serializableContext = JSON.parse(
      JSON.stringify(context),
    ) as Prisma.InputJsonObject;
    const suggestion = await this.prisma.aiSuggestion.create({
      data: {
        userId,
        type: request.type,
        status: asynchronous ? 'queued' : 'running',
        schemaVersion: prompt.schemaVersion,
        promptVersion: prompt.version,
        inputContext: serializableContext,
        inputContextHash: createHash('sha256')
          .update(JSON.stringify(serializableContext))
          .digest('hex'),
        idempotencyKey: request.idempotencyKey ?? null,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      },
    });
    this.publish(suggestion.userId, suggestion.id, suggestion.version);

    if (asynchronous) return toAssistantSuggestionContract(suggestion);
    await this.process(suggestion.id, false);
    return this.get(userId, suggestion.id);
  }

  async get(
    userId: string,
    suggestionId: string,
  ): Promise<AssistantSuggestion> {
    const suggestion = await this.findOwned(userId, suggestionId);
    return toAssistantSuggestionContract(suggestion);
  }

  async process(
    suggestionId: string,
    deferRetryableFailure: boolean,
  ): Promise<AssistantProcessResult> {
    const suggestion = await this.prisma.aiSuggestion.findUnique({
      where: { id: suggestionId },
    });
    if (!suggestion || suggestion.status !== 'running') {
      return { completed: false, retryable: false, errorCode: null };
    }
    const context = this.asContext(suggestion.inputContext);
    const prompt = ASSISTANT_PROMPTS[suggestion.type];
    let result: LlmProviderResult;
    const startedAt = performance.now();
    try {
      result = await this.rateLimiter.run(suggestion.userId, () =>
        this.provider.generateStructured({
          type: suggestion.type,
          schema: assistantOutputByType[
            suggestion.type
          ] as z.ZodType<AssistantSuggestionOutput>,
          schemaName: prompt.schemaName,
          promptVersion: suggestion.promptVersion,
          instructions: prompt.instructions,
          context,
          timeoutMs: this.config.assistantTimeoutMs,
          idempotencyKey: suggestion.idempotencyKey ?? suggestion.id,
        }),
      );
    } catch {
      result = {
        kind: 'error',
        code: 'provider_rate_limited',
        retryable: true,
      };
    }
    const usage = result.kind === 'success' ? result.usage : {};
    this.metrics.recordAssistant({
      promptVersion: suggestion.promptVersion,
      provider:
        result.kind === 'success'
          ? result.provider
          : this.config.assistantProvider,
      outcome: result.kind === 'success' ? 'success' : result.code,
      durationMs: performance.now() - startedAt,
      inputTokens:
        typeof usage.inputTokens === 'number' ? usage.inputTokens : null,
      outputTokens:
        typeof usage.outputTokens === 'number' ? usage.outputTokens : null,
    });

    if (result.kind === 'success') {
      try {
        const output = await this.semanticValidator.validate(
          suggestion.userId,
          suggestion.type,
          result.data,
          context,
        );
        const updated = await this.prisma.aiSuggestion.updateMany({
          where: { id: suggestion.id, status: 'running' },
          data: {
            status: 'completed',
            output: output as unknown as Prisma.InputJsonValue,
            provider: result.provider,
            model: result.model,
            providerRequestId: result.requestId,
            usage: result.usage as Prisma.InputJsonObject,
            errorCode: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            version: { increment: 1 },
          },
        });
        if (updated.count === 1) await this.publishCurrent(suggestion.id);
        return {
          completed: updated.count === 1,
          retryable: false,
          errorCode: null,
        };
      } catch {
        return this.fail(suggestion, 'provider_invalid_output', false);
      }
    }

    const errorCode = result.kind === 'refusal' ? result.code : result.code;
    const retryable = result.kind === 'error' && result.retryable;
    if (deferRetryableFailure && retryable) {
      return { completed: false, retryable: true, errorCode };
    }
    return this.fail(suggestion, errorCode, retryable);
  }

  async accept(
    userId: string,
    suggestionId: string,
    edit?: EditAssistantSuggestion,
  ): Promise<AssistantSuggestion> {
    const current = await this.findOwned(userId, suggestionId);
    if (current.status === 'accepted')
      return toAssistantSuggestionContract(current);
    if (current.status !== 'completed' || current.output === null) {
      throw new ConflictException({
        code: 'ASSISTANT_SUGGESTION_NOT_APPLICABLE',
        message: 'Only a completed suggestion can be applied.',
      });
    }
    const rawOutput = edit?.output ?? current.output;
    const output = assistantOutputByType[current.type].parse(rawOutput);
    const context = this.asContext(current.inputContext);
    await this.semanticValidator.validate(
      userId,
      current.type,
      output,
      context,
    );

    const result = await this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.aiSuggestion.findFirst({
        where: { id: suggestionId, userId },
      });
      if (!locked) this.throwNotFound();
      if (locked.status === 'accepted') {
        return { planId: null as string | null };
      }
      if (locked.status !== 'completed') {
        throw new ConflictException({
          code: 'ASSISTANT_SUGGESTION_NOT_APPLICABLE',
          message: 'The suggestion changed before it could be applied.',
        });
      }
      const planId = await this.applyOutput(
        transaction,
        userId,
        suggestionId,
        current.type,
        output,
      );
      const accepted = await transaction.aiSuggestion.updateMany({
        where: { id: suggestionId, userId, status: 'completed' },
        data: {
          status: 'accepted',
          output: output as unknown as Prisma.InputJsonValue,
          acceptedAt: this.clock.now(),
          version: { increment: 1 },
        },
      });
      if (accepted.count !== 1) {
        throw new ConflictException({
          code: 'ASSISTANT_SUGGESTION_CONFLICT',
          message: 'The suggestion changed before it could be applied.',
        });
      }
      return { planId };
    });

    if (result.planId) {
      await this.dailyPlans.publishPlanChanged(userId, result.planId);
    }
    await this.publishCurrent(suggestionId);
    return this.get(userId, suggestionId);
  }

  async reject(
    userId: string,
    suggestionId: string,
    input: RejectAssistantSuggestion,
  ): Promise<AssistantSuggestion> {
    const current = await this.findOwned(userId, suggestionId);
    if (current.status === 'rejected')
      return toAssistantSuggestionContract(current);
    if (['accepted', 'expired'].includes(current.status)) {
      throw new ConflictException({
        code: 'ASSISTANT_SUGGESTION_NOT_REJECTABLE',
        message: 'This suggestion can no longer be rejected.',
      });
    }
    const updated = await this.prisma.aiSuggestion.updateMany({
      where: { id: suggestionId, userId, status: current.status },
      data: {
        status: 'rejected',
        rejectionReason: input.reason,
        rejectedAt: this.clock.now(),
        leaseOwner: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'ASSISTANT_SUGGESTION_CONFLICT',
        message: 'The suggestion changed before it could be rejected.',
      });
    }
    await this.publishCurrent(suggestionId);
    return this.get(userId, suggestionId);
  }

  private async applyOutput(
    transaction: Prisma.TransactionClient,
    userId: string,
    suggestionId: string,
    type: keyof typeof assistantOutputByType,
    output: AssistantSuggestionOutput,
  ): Promise<string | null> {
    switch (type) {
      case 'task_extraction':
        for (const task of (output as TaskExtractionOutput).tasks) {
          const created = await this.tasks.createInTransaction(
            transaction,
            userId,
            {
              title: task.title,
              category: task.category,
              priority: 'normal',
              estimateMinutes: task.estimateMinutes,
            },
          );
          await this.tasks.appendAssistantAcceptanceInTransaction(
            transaction,
            userId,
            created.id,
            suggestionId,
            { capability: 'task_extraction' },
          );
        }
        return null;
      case 'task_decomposition': {
        const decomposition = output as TaskDecompositionOutput;
        const parent = await transaction.task.findFirst({
          where: {
            id: decomposition.parentTaskId,
            userId,
            version: decomposition.parentTaskVersion,
          },
        });
        if (!parent) this.throwStale();
        for (const subtask of decomposition.subtasks) {
          const created = await this.tasks.createInTransaction(
            transaction,
            userId,
            {
              title: subtask.title,
              category: parent.category,
              priority: parent.priority,
              estimateMinutes: subtask.estimateMinutes,
              parentTaskId: parent.id,
            },
          );
          await this.tasks.appendAssistantAcceptanceInTransaction(
            transaction,
            userId,
            created.id,
            suggestionId,
            { capability: 'task_decomposition', parentTaskId: parent.id },
          );
        }
        return null;
      }
      case 'daily_plan': {
        const plan = await this.dailyPlans.applySuggestionInTransaction(
          transaction,
          userId,
          suggestionId,
          output as DailyPlanSuggestionOutput,
        );
        return plan.id;
      }
      case 'carryover_diagnosis': {
        const diagnosis = output as CarryoverDiagnosisOutput;
        await this.tasks.setBlockReasonFromSuggestionInTransaction(
          transaction,
          {
            userId,
            taskId: diagnosis.taskId,
            expectedVersion: diagnosis.taskVersion,
            suggestionId,
            blockReason: diagnosis.blockReason,
            details: diagnosis.details,
          },
        );
        return null;
      }
      case 'outcome_summary': {
        const summary = output as OutcomeSummaryOutput;
        await this.reviews.setAssistantSummaryInTransaction(
          transaction,
          userId,
          summary.reviewDate,
          summary.summary,
        );
        return null;
      }
    }
  }

  private async fail(
    suggestion: { id: string; userId: string },
    errorCode: string,
    retryable: boolean,
  ): Promise<AssistantProcessResult> {
    const updated = await this.prisma.aiSuggestion.updateMany({
      where: { id: suggestion.id, status: 'running' },
      data: {
        status: 'failed',
        errorCode,
        leaseOwner: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (updated.count === 1) await this.publishCurrent(suggestion.id);
    return { completed: false, retryable, errorCode };
  }

  private async findOwned(userId: string, suggestionId: string) {
    const suggestion = await this.prisma.aiSuggestion.findFirst({
      where: { id: suggestionId, userId },
    });
    if (!suggestion) this.throwNotFound();
    return suggestion;
  }

  private asContext(value: Prisma.JsonValue): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Stored assistant context must be an object.');
    }
    return value as Record<string, unknown>;
  }

  private publish(userId: string, id: string, version: number): void {
    this.invalidations.publish(userId, {
      type: 'suggestion.changed',
      resourceId: id,
      resourceVersion: version,
    });
  }

  private async publishCurrent(suggestionId: string): Promise<void> {
    const suggestion = await this.prisma.aiSuggestion.findUnique({
      where: { id: suggestionId },
      select: { id: true, userId: true, version: true },
    });
    if (suggestion) {
      this.publish(suggestion.userId, suggestion.id, suggestion.version);
    }
  }

  private throwNotFound(): never {
    throw new NotFoundException({
      code: 'ASSISTANT_SUGGESTION_NOT_FOUND',
      message: 'Assistant suggestion was not found.',
    });
  }

  private throwStale(): never {
    throw new ConflictException({
      code: 'ASSISTANT_SUGGESTION_STALE',
      message: 'Referenced task state changed. Generate a fresh suggestion.',
    });
  }
}
