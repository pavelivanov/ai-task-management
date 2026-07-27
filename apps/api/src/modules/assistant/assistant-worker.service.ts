import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AppConfig } from '../../config/app-config.service';
import { OperationalMetrics } from '../../common/observability/operational-metrics.service';
import { StructuredLogger } from '../../common/observability/structured-logger.service';
import { runSafeBackgroundTask } from '../../common/runtime/safe-background-task';
import { PrismaService } from '../../database/prisma.service';
import { type Clock, CLOCK } from '../auth/clock';
import { InvalidationStreamService } from '../invalidations/invalidation-stream.service';
import { AssistantService } from './assistant.service';

@Injectable()
export class AssistantWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly workerId = randomUUID();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly assistant: AssistantService,
    private readonly invalidations: InvalidationStreamService,
    private readonly metrics: OperationalMetrics,
    private readonly logger: StructuredLogger,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () =>
        void runSafeBackgroundTask({
          failureEvent: 'assistant.worker.loop_failed',
          logger: this.logger,
          onFailure: () => this.metrics.recordAssistantWorkerFailure(),
          task: () => this.runOnce(),
        }),
      this.config.assistantWorkerIntervalMs,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const claimed = await this.claimOne();
      if (!claimed) return false;
      const startedAt = performance.now();
      this.metrics.recordAssistantWorkerClaim(
        this.clock.now().getTime() - claimed.createdAt.getTime(),
      );
      const result = await this.assistant.process(claimed.id, true);
      if (result.errorCode) this.metrics.recordAssistantWorkerFailure();
      if (result.retryable) {
        const current = await this.prisma.aiSuggestion.findUnique({
          where: { id: claimed.id },
        });
        if (!current || current.status !== 'running') return true;
        const canRetry = current.retryCount < current.maxRetries;
        const retryCount = current.retryCount + 1;
        const nextAttemptAt = canRetry
          ? new Date(
              this.clock.now().getTime() +
                Math.min(60_000, 2 ** retryCount * 1_000),
            )
          : null;
        await this.prisma.aiSuggestion.update({
          where: { id: current.id },
          data: {
            status: canRetry ? 'queued' : 'failed',
            retryCount,
            errorCode: result.errorCode,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt,
            version: { increment: 1 },
          },
        });
        await this.publishCurrent(current.id);
      }
      this.logger.info('assistant.worker.processed', {
        suggestionId: claimed.id,
        outcome: result.completed ? 'completed' : 'not_completed',
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        durationMs: Math.round(performance.now() - startedAt),
      });
      return true;
    } finally {
      this.running = false;
    }
  }

  private async claimOne() {
    const now = this.clock.now();
    const candidate = await this.prisma.aiSuggestion.findFirst({
      where: {
        expiresAt: { gt: now },
        OR: [
          {
            status: 'queued',
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          { status: 'running', leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!candidate) return null;
    const leaseExpiresAt = new Date(
      now.getTime() + this.config.assistantLeaseSeconds * 1_000,
    );
    const claimed = await this.prisma.aiSuggestion.updateMany({
      where: {
        id: candidate.id,
        version: candidate.version,
        OR: [
          {
            status: 'queued',
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          { status: 'running', leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: 'running',
        leaseOwner: this.workerId,
        leaseExpiresAt,
        nextAttemptAt: null,
        version: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    await this.publishCurrent(candidate.id);
    return this.prisma.aiSuggestion.findUnique({
      where: { id: candidate.id },
    });
  }

  private async publishCurrent(suggestionId: string): Promise<void> {
    const suggestion = await this.prisma.aiSuggestion.findUnique({
      where: { id: suggestionId },
      select: { id: true, userId: true, version: true },
    });
    if (suggestion) {
      this.invalidations.publish(suggestion.userId, {
        type: 'suggestion.changed',
        resourceId: suggestion.id,
        resourceVersion: suggestion.version,
      });
    }
  }
}
