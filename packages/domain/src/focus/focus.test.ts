import { describe, expect, it } from 'vitest';

import {
  FOCUS_SESSION_STATUSES,
  FOCUS_TRANSITION_TARGETS,
  FocusTransitionError,
  focusedDurationMilliseconds,
  transitionFocusSession,
  type FocusSessionStatus,
} from './index.js';

describe('focus transitions', () => {
  it.each(
    FOCUS_SESSION_STATUSES.flatMap((from) =>
      FOCUS_SESSION_STATUSES.map((to) => [from, to] as const),
    ),
  )('defines the exhaustive %s -> %s transition', (from, to) => {
    if (from === to) {
      expect(transitionFocusSession(from, to)).toMatchObject({ noop: true });
      return;
    }
    if (FOCUS_TRANSITION_TARGETS[from].includes(to)) {
      expect(transitionFocusSession(from, to)).toMatchObject({
        from,
        to,
        noop: false,
      });
      return;
    }
    expect(() => transitionFocusSession(from, to)).toThrow(
      FocusTransitionError,
    );
  });

  it.each([
    ['paused', 'paused'],
    ['waiting', 'waiting'],
    ['blocked', null],
    ['completed', null],
    ['stopped', null],
  ] as const)(
    'maps an active transition to %s with the expected new segment',
    (to, openSegmentType) => {
      expect(
        transitionFocusSession('active', to as FocusSessionStatus),
      ).toMatchObject({
        closeOpenSegment: true,
        openSegmentType,
      });
    },
  );

  it.each(['paused', 'waiting', 'blocked'] as const)(
    'resumes %s with a focused segment',
    (from) => {
      expect(transitionFocusSession(from, 'active')).toMatchObject({
        closeOpenSegment: true,
        openSegmentType: 'focused',
      });
    },
  );

  it.each(['paused', 'waiting', 'blocked'] as const)(
    'allows %s sessions to stop without resuming',
    (from) => {
      expect(transitionFocusSession(from, 'stopped')).toMatchObject({
        terminal: true,
        openSegmentType: null,
      });
    },
  );
});

describe('focus duration', () => {
  const at = (minute: number) =>
    new Date(`2026-07-20T09:${minute.toString().padStart(2, '0')}:00.000Z`);

  it('sums closed and current focused segments without counting pauses', () => {
    expect(
      focusedDurationMilliseconds(
        [
          { type: 'focused', startedAt: at(0), endedAt: at(10) },
          { type: 'paused', startedAt: at(10), endedAt: at(20) },
          { type: 'focused', startedAt: at(20), endedAt: null },
        ],
        at(35),
      ),
    ).toBe(25 * 60 * 1_000);
  });

  it.each([
    [[{ type: 'focused', startedAt: at(10), endedAt: at(5) }], at(20)],
    [
      [
        { type: 'focused', startedAt: at(0), endedAt: at(15) },
        { type: 'paused', startedAt: at(10), endedAt: at(20) },
      ],
      at(30),
    ],
    [
      [
        { type: 'focused', startedAt: at(0), endedAt: null },
        { type: 'paused', startedAt: at(10), endedAt: at(20) },
      ],
      at(30),
    ],
    [[{ type: 'focused', startedAt: at(20), endedAt: null }], at(10)],
  ] as const)(
    'rejects negative, overlapping, multiple-open, or future segments %#',
    (segments, now) => {
      expect(() => focusedDurationMilliseconds(segments, now)).toThrow(
        RangeError,
      );
    },
  );

  it('returns zero for an empty session', () => {
    expect(focusedDurationMilliseconds([], at(0))).toBe(0);
  });
});
