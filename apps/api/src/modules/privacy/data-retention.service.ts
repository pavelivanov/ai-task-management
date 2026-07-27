import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { AppConfig } from '../../config/app-config.service';
import { StructuredLogger } from '../../common/observability/structured-logger.service';
import { runSafeBackgroundTask } from '../../common/runtime/safe-background-task';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { type Clock, CLOCK } from '../auth/clock';
import { InvalidationStreamService } from '../invalidations/invalidation-stream.service';

export interface RetentionSweepResult {
  expiredSuggestions: number;
  deletedConversationMessages: number;
  deletedConversations: number;
  deletedSessions: number;
  deletedNotifications: number;
  deletedPushSubscriptions: number;
}

const suggestionExpiryBatchSize = 100;
const maximumSuggestionExpiryBatchesPerSweep = 100;

interface SuggestionExpiryBatchResult {
  expired: number;
  selected: number;
}

@Injectable()
export class DataRetentionService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly config: AppConfig,
    private readonly invalidations: InvalidationStreamService,
    private readonly logger: StructuredLogger,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () =>
        void runSafeBackgroundTask({
          failureEvent: 'privacy.retention.loop_failed',
          logger: this.logger,
          task: () => this.runOnce(),
        }),
      this.config.retentionSweepIntervalMs,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<RetentionSweepResult> {
    if (this.running) return this.emptyResult();
    this.running = true;
    try {
      const now = this.clock.now();
      const assistantCutoff = this.daysBefore(
        now,
        this.config.assistantRetentionDays,
      );
      const notificationCutoff = this.daysBefore(
        now,
        this.config.notificationRetentionDays,
      );
      const pushCutoff = this.daysBefore(
        now,
        this.config.revokedPushRetentionDays,
      );

      const expiredSuggestions = await this.expireSuggestions(now);
      const deletedConversationMessages =
        await this.prisma.conversationMessage.deleteMany({
          where: { createdAt: { lte: assistantCutoff } },
        });
      const deletedConversations = await this.prisma.conversation.deleteMany({
        where: {
          updatedAt: { lte: assistantCutoff },
          messages: { none: {} },
          suggestions: { none: {} },
        },
      });
      const deletedSessions = await this.auth.cleanupExpiredSessions();
      const deletedNotifications = await this.prisma.notification.deleteMany({
        where: { createdAt: { lte: notificationCutoff } },
      });
      const deletedPushSubscriptions =
        await this.prisma.pushSubscription.deleteMany({
          where: {
            revokedAt: { not: null, lte: pushCutoff },
          },
        });

      return {
        expiredSuggestions,
        deletedConversationMessages: deletedConversationMessages.count,
        deletedConversations: deletedConversations.count,
        deletedSessions,
        deletedNotifications: deletedNotifications.count,
        deletedPushSubscriptions: deletedPushSubscriptions.count,
      };
    } finally {
      this.running = false;
    }
  }

  private async expireSuggestions(now: Date): Promise<number> {
    let expired = 0;
    for (
      let batch = 0;
      batch < maximumSuggestionExpiryBatchesPerSweep;
      batch += 1
    ) {
      const result = await this.expireSuggestionBatch(now);
      expired += result.expired;
      if (result.selected < suggestionExpiryBatchSize) break;
    }
    return expired;
  }

  private async expireSuggestionBatch(
    now: Date,
  ): Promise<SuggestionExpiryBatchResult> {
    const suggestions = await this.prisma.aiSuggestion.findMany({
      where: { expiresAt: { lte: now }, status: { not: 'expired' } },
      select: { id: true, userId: true, version: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: suggestionExpiryBatchSize,
    });
    let count = 0;
    for (const suggestion of suggestions) {
      const update = await this.prisma.aiSuggestion.updateMany({
        where: { id: suggestion.id, status: { not: 'expired' } },
        data: {
          status: 'expired',
          inputContext: { expired: true },
          output: Prisma.JsonNull,
          providerRequestId: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) continue;
      count += 1;
      this.invalidations.publish(suggestion.userId, {
        type: 'suggestion.changed',
        resourceId: suggestion.id,
        resourceVersion: suggestion.version + 1,
      });
    }
    return { expired: count, selected: suggestions.length };
  }

  private daysBefore(now: Date, days: number): Date {
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
  }

  private emptyResult(): RetentionSweepResult {
    return {
      expiredSuggestions: 0,
      deletedConversationMessages: 0,
      deletedConversations: 0,
      deletedSessions: 0,
      deletedNotifications: 0,
      deletedPushSubscriptions: 0,
    };
  }
}
