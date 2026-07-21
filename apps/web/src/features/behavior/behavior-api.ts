import {
  notificationPageSchema,
  pushConfigurationSchema,
  pushSubscriptionSchema,
  waitingSuggestionsSchema,
  type NotificationPage,
  type PushSubscription,
  type WaitingSuggestions,
} from '@execution/contracts';

import { apiCommand, apiRequest, jsonBody } from '../../lib/api-client';

export function getNotifications(): Promise<NotificationPage> {
  return apiRequest('/notifications', notificationPageSchema);
}

export function markNotificationRead(id: string): Promise<void> {
  return apiCommand(`/notifications/${id}/read`, { method: 'POST' });
}

export function markAllNotificationsRead(): Promise<void> {
  return apiCommand('/notifications/read-all', { method: 'POST' });
}

export function getWaitingSuggestions(): Promise<WaitingSuggestions> {
  return apiRequest('/behavior/waiting-suggestions', waitingSuggestionsSchema);
}

export function getPushConfiguration() {
  return apiRequest('/notifications/push/config', pushConfigurationSchema);
}

export function savePushSubscription(
  subscription: globalThis.PushSubscription,
): Promise<PushSubscription> {
  return apiRequest(
    '/notifications/push/subscriptions',
    pushSubscriptionSchema,
    {
      method: 'POST',
      ...jsonBody(subscription.toJSON()),
    },
  );
}

export function revokePushSubscription(endpoint: string): Promise<void> {
  return apiCommand('/notifications/push/subscriptions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    ...jsonBody({ endpoint }),
  });
}
