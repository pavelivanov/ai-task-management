import type {
  AssistantTrigger as AssistantTriggerContract,
  Notification as NotificationContract,
  PushSubscription as PushSubscriptionContract,
} from '@execution/contracts';

import type {
  AssistantTrigger,
  Notification,
  PushSubscription,
} from '../../generated/prisma/client';
import { formatDatabaseDate } from '../daily-plans/daily-plan-presenter';

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toAssistantTriggerContract(
  trigger: AssistantTrigger,
): AssistantTriggerContract {
  return {
    id: trigger.id,
    type: trigger.type,
    status: trigger.status,
    relatedTaskId: trigger.relatedTaskId,
    relatedDate: trigger.relatedDate
      ? formatDatabaseDate(trigger.relatedDate)
      : null,
    eligibleAt: trigger.eligibleAt.toISOString(),
    firedAt: trigger.firedAt?.toISOString() ?? null,
    resolvedAt: trigger.resolvedAt?.toISOString() ?? null,
    outcome: objectValue(trigger.outcome),
    createdAt: trigger.createdAt.toISOString(),
  };
}

export function toNotificationContract(
  notification: Notification,
): NotificationContract {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    deepLink: notification.deepLink,
    scheduledAt: notification.scheduledAt.toISOString(),
    sentAt: notification.sentAt?.toISOString() ?? null,
    readAt: notification.readAt?.toISOString() ?? null,
    relatedTaskId: notification.relatedTaskId,
    deliveryStatus: notification.deliveryStatus,
    createdAt: notification.createdAt.toISOString(),
  };
}

export function toPushSubscriptionContract(
  subscription: PushSubscription,
): PushSubscriptionContract {
  return {
    id: subscription.id,
    endpointFingerprint: subscription.endpointFingerprint,
    createdAt: subscription.createdAt.toISOString(),
    lastUsedAt: subscription.lastUsedAt.toISOString(),
    revokedAt: subscription.revokedAt?.toISOString() ?? null,
  };
}
