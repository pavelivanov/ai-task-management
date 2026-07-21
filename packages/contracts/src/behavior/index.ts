import { z } from 'zod';

import { taskSchema } from '../tasks/index.js';

export const assistantTriggerTypeSchema = z.enum([
  'morning_plan_missing',
  'estimate_exceeded',
  'task_repeatedly_carried',
  'current_task_waiting',
  'end_of_day_review',
  'plan_over_capacity',
  'deadline_risk',
]);

export const assistantTriggerStatusSchema = z.enum([
  'eligible',
  'fired',
  'resolved',
]);

export const assistantTriggerSchema = z.object({
  id: z.uuid(),
  type: assistantTriggerTypeSchema,
  status: assistantTriggerStatusSchema,
  relatedTaskId: z.uuid().nullable(),
  relatedDate: z.string().nullable(),
  eligibleAt: z.iso.datetime({ offset: true }),
  firedAt: z.iso.datetime({ offset: true }).nullable(),
  resolvedAt: z.iso.datetime({ offset: true }).nullable(),
  outcome: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime({ offset: true }),
});

export const notificationTypeSchema = z.enum([
  'morning_plan',
  'estimate_exceeded',
  'repeated_carryover',
  'current_task_waiting',
  'end_of_day_review',
  'plan_over_capacity',
  'deadline_risk',
]);

export const notificationDeliveryStatusSchema = z.enum([
  'pending',
  'sending',
  'retry',
  'sent',
  'failed',
  'skipped',
]);

export const notificationSchema = z.object({
  id: z.uuid(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  deepLink: z.string(),
  scheduledAt: z.iso.datetime({ offset: true }),
  sentAt: z.iso.datetime({ offset: true }).nullable(),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  relatedTaskId: z.uuid().nullable(),
  deliveryStatus: notificationDeliveryStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
});

export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
});

export const pushConfigurationSchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string().nullable(),
});

export const pushSubscriptionInputSchema = z
  .object({
    endpoint: z.url().max(4_096),
    expirationTime: z.number().nullable(),
    keys: z
      .object({
        p256dh: z.string().min(1).max(1_024),
        auth: z.string().min(1).max(1_024),
      })
      .strict(),
  })
  .strict();

export const pushSubscriptionSchema = z.object({
  id: z.uuid(),
  endpointFingerprint: z.string().length(64),
  createdAt: z.iso.datetime({ offset: true }),
  lastUsedAt: z.iso.datetime({ offset: true }),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const unsubscribePushSchema = z
  .object({ endpoint: z.url().max(4_096) })
  .strict();

export const notificationIdParamSchema = z.uuid();

export const waitingSuggestionsSchema = z.object({
  waitingSessionId: z.uuid(),
  expectedWaitMinutes: z.number().int().min(5),
  eligibleSince: z.iso.datetime({ offset: true }),
  explanation: z.string().nullable(),
  tasks: z.array(taskSchema).max(3),
});

export const assistantTriggerPageSchema = z.object({
  items: z.array(assistantTriggerSchema),
});

export type AssistantTriggerType = z.infer<typeof assistantTriggerTypeSchema>;
export type AssistantTriggerStatus = z.infer<
  typeof assistantTriggerStatusSchema
>;
export type AssistantTrigger = z.infer<typeof assistantTriggerSchema>;
export type AssistantTriggerPage = z.infer<typeof assistantTriggerPageSchema>;
export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type NotificationDeliveryStatus = z.infer<
  typeof notificationDeliveryStatusSchema
>;
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export type PushConfiguration = z.infer<typeof pushConfigurationSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;
export type UnsubscribePush = z.infer<typeof unsubscribePushSchema>;
export type WaitingSuggestions = z.infer<typeof waitingSuggestionsSchema>;
