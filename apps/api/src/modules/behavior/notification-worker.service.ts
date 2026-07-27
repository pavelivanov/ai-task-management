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
import { NotificationsService } from './notifications.service';
import {
  type PushDeliveryResult,
  type PushGateway,
  PUSH_GATEWAY,
} from './push-gateway';

@Injectable()
export class NotificationWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly workerId = randomUUID();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly notifications: NotificationsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PUSH_GATEWAY) private readonly gateway: PushGateway,
    private readonly metrics: OperationalMetrics,
    private readonly logger: StructuredLogger,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () =>
        void runSafeBackgroundTask({
          failureEvent: 'notification.worker.loop_failed',
          logger: this.logger,
          onFailure: () => this.metrics.recordPushOutcome('failed'),
          task: () => this.runOnce(),
        }),
      this.config.notificationWorkerIntervalMs,
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
      const subscriptions = await this.prisma.pushSubscription.findMany({
        where: {
          userId: claimed.userId,
          revokedAt: null,
          OR: [
            { expirationTime: null },
            { expirationTime: { gt: this.clock.now() } },
          ],
        },
      });
      if (!this.gateway.enabled || subscriptions.length === 0) {
        const outcome = this.gateway.enabled ? 'skipped' : 'disabled';
        this.metrics.recordPushOutcome(outcome);
        await this.finish(
          claimed.id,
          'skipped',
          null,
          'NO_ACTIVE_SUBSCRIPTION',
        );
        this.logger.info('notification.worker.processed', {
          notificationId: claimed.id,
          outcome,
        });
        return true;
      }

      const results: Array<{ id: string; result: PushDeliveryResult }> = [];
      for (const subscription of subscriptions) {
        const result = await this.gateway.send(
          {
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh,
            authSecret: subscription.authSecret,
          },
          {
            notificationId: claimed.id,
            title: claimed.title,
            body: 'Open Fieldnote to review.',
            deepLink: claimed.deepLink,
          },
        );
        this.metrics.recordPushOutcome(result.kind);
        results.push({ id: subscription.id, result });
      }

      const now = this.clock.now();
      const revokedIds = results
        .filter(({ result }) => result.kind === 'revoked')
        .map(({ id }) => id);
      if (revokedIds.length > 0) {
        await this.prisma.pushSubscription.updateMany({
          where: { id: { in: revokedIds }, userId: claimed.userId },
          data: { revokedAt: now },
        });
      }
      const deliveredIds = results
        .filter(({ result }) => result.kind === 'delivered')
        .map(({ id }) => id);
      if (deliveredIds.length > 0) {
        await this.prisma.pushSubscription.updateMany({
          where: { id: { in: deliveredIds }, userId: claimed.userId },
          data: { lastUsedAt: now },
        });
        await this.finish(claimed.id, 'sent', now, null);
        this.logger.info('notification.worker.processed', {
          notificationId: claimed.id,
          outcome: 'sent',
        });
        return true;
      }

      const transient = results
        .map(({ result }) => result)
        .find(
          (
            result,
          ): result is Extract<PushDeliveryResult, { kind: 'transient' }> =>
            result.kind === 'transient',
        );
      if (transient && claimed.deliveryAttempts + 1 < claimed.maxAttempts) {
        const attempts = claimed.deliveryAttempts + 1;
        await this.prisma.notification.update({
          where: { id: claimed.id },
          data: {
            deliveryStatus: 'retry',
            deliveryAttempts: attempts,
            nextAttemptAt: new Date(
              now.getTime() + Math.min(60_000, 2 ** attempts * 1_000),
            ),
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: transient.code,
            version: { increment: 1 },
          },
        });
        await this.notifications.publish(claimed.id);
        this.logger.info('notification.worker.processed', {
          notificationId: claimed.id,
          outcome: 'retry',
          errorCode: transient.code,
        });
        return true;
      }
      const finalResult = results
        .map(({ result }) => result)
        .find((result) => result.kind !== 'delivered');
      const finalCode =
        finalResult && 'code' in finalResult
          ? finalResult.code
          : 'DELIVERY_FAILED';
      await this.finish(claimed.id, 'failed', null, finalCode);
      this.logger.info('notification.worker.processed', {
        notificationId: claimed.id,
        outcome: 'failed',
        errorCode: finalCode,
      });
      return true;
    } finally {
      this.running = false;
    }
  }

  private async claimOne() {
    const now = this.clock.now();
    const candidate = await this.prisma.notification.findFirst({
      where: {
        scheduledAt: { lte: now },
        OR: [
          {
            deliveryStatus: { in: ['pending', 'retry'] },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          { deliveryStatus: 'sending', leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    });
    if (!candidate) return null;
    const claimed = await this.prisma.notification.updateMany({
      where: {
        id: candidate.id,
        version: candidate.version,
        OR: [
          { deliveryStatus: { in: ['pending', 'retry'] } },
          { deliveryStatus: 'sending', leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        deliveryStatus: 'sending',
        leaseOwner: this.workerId,
        leaseExpiresAt: new Date(
          now.getTime() + this.config.notificationLeaseSeconds * 1_000,
        ),
        nextAttemptAt: null,
        version: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    await this.notifications.publish(candidate.id);
    return this.prisma.notification.findUnique({ where: { id: candidate.id } });
  }

  private async finish(
    id: string,
    deliveryStatus: 'sent' | 'failed' | 'skipped',
    sentAt: Date | null,
    lastErrorCode: string | null,
  ): Promise<void> {
    await this.prisma.notification.update({
      where: { id },
      data: {
        deliveryStatus,
        sentAt,
        deliveryAttempts: { increment: 1 },
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode,
        version: { increment: 1 },
      },
    });
    await this.notifications.publish(id);
  }
}
