import { describe, expect, it } from 'vitest';

import {
  pushSubscriptionInputSchema,
  waitingSuggestionsSchema,
} from './index.js';

const task = {
  id: '1fd434cb-85bd-4a44-9976-9947565626fd',
  title: 'Short follow-up',
  description: null,
  category: 'work',
  status: 'backlog',
  priority: 'normal',
  estimateMinutes: 5,
  dueAt: null,
  projectId: null,
  parentTaskId: null,
  blockReason: null,
  blockReasonDetails: null,
  carryoverCount: 0,
  version: 1,
  createdAt: '2026-07-21T10:00:00.000Z',
  updatedAt: '2026-07-21T10:00:00.000Z',
  completedAt: null,
} as const;

describe('behavior contracts', () => {
  it('accepts the browser subscription shape without exposing ownership fields', () => {
    expect(
      pushSubscriptionInputSchema.parse({
        endpoint: 'https://push.example.test/subscription',
        expirationTime: null,
        keys: { p256dh: 'public-key', auth: 'secret-key' },
      }),
    ).toMatchObject({ expirationTime: null });
    expect(() =>
      pushSubscriptionInputSchema.parse({
        endpoint: 'https://push.example.test/subscription',
        expirationTime: null,
        keys: { p256dh: 'public-key', auth: 'secret-key' },
        userId: '1fd434cb-85bd-4a44-9976-9947565626fd',
      }),
    ).toThrow();
  });

  it('caps waiting suggestions at three tasks', () => {
    const value = {
      waitingSessionId: '30328aa8-eeed-4f57-80a5-46e887c22e95',
      expectedWaitMinutes: 15,
      eligibleSince: '2026-07-21T10:00:00.000Z',
      explanation: null,
      tasks: [task, task, task],
    };

    expect(waitingSuggestionsSchema.parse(value).tasks).toHaveLength(3);
    expect(() =>
      waitingSuggestionsSchema.parse({
        ...value,
        tasks: [...value.tasks, task],
      }),
    ).toThrow();
  });
});
