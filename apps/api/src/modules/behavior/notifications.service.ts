import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  NotificationPage,
  NotificationType,
  PushConfiguration,
  PushSubscription,
  PushSubscriptionInput,
} from '@execution/contracts';
import { createHash } from 'node:crypto';

import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { type Clock, CLOCK } from '../auth/clock';
import { InvalidationStreamService } from '../invalidations/invalidation-stream.service';
import {
  toNotificationContract,
  toPushSubscriptionContract,
} from './behavior-presenter';
import { type PushGateway, PUSH_GATEWAY } from './push-gateway';

type Transaction = Prisma.TransactionClient;

export interface CreateNotificationInput {
  userId: string;
  assistantTriggerId?: string;
  relatedTaskId?: string;
  type: NotificationType;
  title: string;
  body: string;
  deepLink: string;
  dedupeKey: string;
  scheduledAt: Date;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly invalidations: InvalidationStreamService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PUSH_GATEWAY) private readonly gateway: PushGateway,
  ) {}

  async list(userId: string): Promise<NotificationPage> {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items: items.map(toNotificationContract), unreadCount };
  }

  configuration(): PushConfiguration {
    const publicKey =
      this.config.vapidPublicKey ??
      (this.config.pushProvider === 'fake' ? 'test-public-key' : null);
    return {
      enabled: this.gateway.enabled && Boolean(publicKey),
      publicKey: this.gateway.enabled ? publicKey : null,
    };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) this.throwNotFound();
    if (notification.readAt) return;
    const updated = await this.prisma.notification.updateMany({
      where: { id: notification.id, userId, readAt: null },
      data: { readAt: this.clock.now(), version: { increment: 1 } },
    });
    if (updated.count === 1) await this.publish(notification.id);
  }

  async markAllRead(userId: string): Promise<void> {
    const now = this.clock.now();
    const unread = await this.prisma.notification.findMany({
      where: { userId, readAt: null },
      select: { id: true },
      take: 100,
    });
    await this.prisma.notification.updateMany({
      where: { userId, id: { in: unread.map(({ id }) => id) }, readAt: null },
      data: { readAt: now, version: { increment: 1 } },
    });
    for (const item of unread) await this.publish(item.id);
  }

  async subscribe(
    userId: string,
    input: PushSubscriptionInput,
  ): Promise<PushSubscription> {
    const endpointFingerprint = this.fingerprint(input.endpoint);
    const now = this.clock.now();
    const expirationTime =
      input.expirationTime === null ? null : new Date(input.expirationTime);
    const updateData = {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      authSecret: input.keys.auth,
      expirationTime,
      lastUsedAt: now,
      revokedAt: null,
    };
    const updated = await this.prisma.pushSubscription.updateMany({
      where: { endpointFingerprint, userId },
      data: updateData,
    });
    if (updated.count === 0) {
      try {
        const created = await this.prisma.pushSubscription.create({
          data: {
            userId,
            endpoint: input.endpoint,
            endpointFingerprint,
            p256dh: input.keys.p256dh,
            authSecret: input.keys.auth,
            expirationTime,
            lastUsedAt: now,
          },
        });
        return toPushSubscriptionContract(created);
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        const existing = await this.prisma.pushSubscription.findUnique({
          where: { endpointFingerprint },
          select: { userId: true },
        });
        if (existing?.userId !== userId) this.throwSubscriptionOwned();
        const retry = await this.prisma.pushSubscription.updateMany({
          where: { endpointFingerprint, userId },
          data: updateData,
        });
        if (retry.count !== 1) this.throwSubscriptionOwned();
      }
    }
    const subscription = await this.prisma.pushSubscription.findUniqueOrThrow({
      where: { endpointFingerprint },
    });
    return toPushSubscriptionContract(subscription);
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.updateMany({
      where: {
        userId,
        endpointFingerprint: this.fingerprint(endpoint),
        revokedAt: null,
      },
      data: { revokedAt: this.clock.now() },
    });
  }

  createInTransaction(
    transaction: Transaction,
    input: CreateNotificationInput,
  ) {
    return transaction.notification.create({
      data: {
        userId: input.userId,
        assistantTriggerId: input.assistantTriggerId ?? null,
        relatedTaskId: input.relatedTaskId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        deepLink: input.deepLink,
        dedupeKey: input.dedupeKey,
        scheduledAt: input.scheduledAt,
      },
    });
  }

  async publish(notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userId: true, version: true },
    });
    if (notification) {
      this.invalidations.publish(notification.userId, {
        type: 'notification.changed',
        resourceId: notification.id,
        resourceVersion: notification.version,
      });
    }
  }

  private fingerprint(endpoint: string): string {
    return createHash('sha256').update(endpoint).digest('hex');
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private throwSubscriptionOwned(): never {
    throw new ConflictException({
      code: 'PUSH_SUBSCRIPTION_OWNED',
      message: 'This browser subscription belongs to another account.',
    });
  }

  private throwNotFound(): never {
    throw new NotFoundException({
      code: 'NOTIFICATION_NOT_FOUND',
      message: 'Notification was not found.',
    });
  }
}
