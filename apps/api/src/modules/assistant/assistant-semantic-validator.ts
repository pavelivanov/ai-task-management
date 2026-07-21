import { ConflictException, Injectable } from '@nestjs/common';
import {
  assistantOutputByType,
  type AssistantSuggestionOutput,
  type AssistantSuggestionType,
  type CarryoverDiagnosisOutput,
  type DailyPlanSuggestionOutput,
  type OutcomeSummaryOutput,
  type TaskDecompositionOutput,
} from '@execution/contracts';

import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AssistantSemanticValidator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async validate(
    userId: string,
    type: AssistantSuggestionType,
    output: AssistantSuggestionOutput,
    context: Record<string, unknown>,
  ): Promise<AssistantSuggestionOutput> {
    const parsed = assistantOutputByType[type].parse(output);
    switch (type) {
      case 'task_extraction':
        return parsed;
      case 'daily_plan':
        await this.validatePlan(
          userId,
          parsed as DailyPlanSuggestionOutput,
          context,
        );
        return parsed;
      case 'task_decomposition':
        await this.validateTaskReference(
          userId,
          (parsed as TaskDecompositionOutput).parentTaskId,
          (parsed as TaskDecompositionOutput).parentTaskVersion,
        );
        return parsed;
      case 'carryover_diagnosis': {
        const diagnosis = parsed as CarryoverDiagnosisOutput;
        const task = await this.validateTaskReference(
          userId,
          diagnosis.taskId,
          diagnosis.taskVersion,
        );
        if (task.carryoverCount < this.config.carryoverDiagnosisCount) {
          this.throwStale();
        }
        return parsed;
      }
      case 'outcome_summary':
        if (
          (parsed as OutcomeSummaryOutput).reviewDate !==
          (context.review as { date?: string } | undefined)?.date
        ) {
          this.throwInvalidReference();
        }
        return parsed;
    }
  }

  private async validatePlan(
    userId: string,
    output: DailyPlanSuggestionOutput,
    context: Record<string, unknown>,
  ): Promise<void> {
    if (output.date !== context.date) this.throwInvalidReference();
    const ids = output.items.map((item) => item.taskId);
    if (new Set(ids).size !== ids.length) this.throwInvalidReference();
    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        id: { in: ids },
        status: { in: ['backlog', 'planned', 'waiting', 'blocked'] },
      },
      select: { id: true, version: true, carryoverCount: true },
    });
    const versions = new Map(tasks.map((task) => [task.id, task.version]));
    if (
      tasks.length !== ids.length ||
      output.items.some(
        (item) => versions.get(item.taskId) !== item.taskVersion,
      )
    ) {
      this.throwStale();
    }
  }

  private async validateTaskReference(
    userId: string,
    taskId: string,
    version: number,
  ) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        userId,
        status: { notIn: ['completed', 'cancelled', 'archived'] },
      },
      select: { id: true, version: true, carryoverCount: true },
    });
    if (!task || task.version !== version) this.throwStale();
    return task;
  }

  private throwStale(): never {
    throw new ConflictException({
      code: 'ASSISTANT_SUGGESTION_STALE',
      message: 'Referenced task state changed. Generate a fresh suggestion.',
    });
  }

  private throwInvalidReference(): never {
    throw new ConflictException({
      code: 'ASSISTANT_INVALID_REFERENCE',
      message: 'The suggestion contains an invalid application reference.',
    });
  }
}
