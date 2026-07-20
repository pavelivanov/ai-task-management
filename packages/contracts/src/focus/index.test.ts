import { describe, expect, it } from 'vitest';

import {
  completeFocusSessionSchema,
  focusReasonSchema,
  startFocusSessionSchema,
  stopFocusSessionSchema,
} from './index.js';

describe('focus contracts', () => {
  it('accepts a bounded start intent', () => {
    expect(
      startFocusSessionSchema.parse({
        taskId: '85b6d95c-1533-45ca-abda-36746c26cb1c',
        initialIntent: 'Ship the lifecycle',
      }),
    ).toMatchObject({ initialIntent: 'Ship the lifecycle' });
  });

  it('requires a non-empty completion outcome', () => {
    expect(() => completeFocusSessionSchema.parse({ outcome: ' ' })).toThrow();
    expect(completeFocusSessionSchema.parse({ outcome: 'Done' })).toEqual({
      outcome: 'Done',
    });
  });

  it('defaults stop to backlog and restricts explicit task states', () => {
    expect(stopFocusSessionSchema.parse({})).toEqual({
      taskStatus: 'backlog',
    });
    expect(() =>
      stopFocusSessionSchema.parse({ taskStatus: 'completed' }),
    ).toThrow();
  });

  it('rejects unknown command properties', () => {
    expect(() => focusReasonSchema.parse({ unexpected: true })).toThrow();
  });
});
