export const FOCUS_SESSION_STATUSES = [
  'active',
  'paused',
  'waiting',
  'blocked',
  'completed',
  'stopped',
] as const;

export type FocusSessionStatus = (typeof FOCUS_SESSION_STATUSES)[number];
export type FocusSegmentType = 'focused' | 'paused' | 'waiting';

export interface FocusTransition {
  from: FocusSessionStatus;
  to: FocusSessionStatus;
  closeOpenSegment: boolean;
  openSegmentType: FocusSegmentType | null;
  terminal: boolean;
  noop: boolean;
}

export class FocusTransitionError extends Error {
  readonly code = 'FOCUS_TRANSITION_UNSUPPORTED';

  constructor(
    readonly from: FocusSessionStatus,
    readonly to: FocusSessionStatus,
  ) {
    super(`Focus session cannot transition from ${from} to ${to}.`);
    this.name = 'FocusTransitionError';
  }
}

const transitionTargets = {
  active: ['paused', 'waiting', 'blocked', 'completed', 'stopped'],
  paused: ['active', 'stopped'],
  waiting: ['active', 'stopped'],
  blocked: ['active', 'stopped'],
  completed: [],
  stopped: [],
} as const satisfies Record<FocusSessionStatus, readonly FocusSessionStatus[]>;

export const FOCUS_TRANSITION_TARGETS: Readonly<
  Record<FocusSessionStatus, readonly FocusSessionStatus[]>
> = transitionTargets;

export function transitionFocusSession(
  from: FocusSessionStatus,
  to: FocusSessionStatus,
): FocusTransition {
  if (from === to) {
    return {
      from,
      to,
      closeOpenSegment: false,
      openSegmentType: null,
      terminal: to === 'completed' || to === 'stopped',
      noop: true,
    };
  }
  if (!FOCUS_TRANSITION_TARGETS[from].includes(to)) {
    throw new FocusTransitionError(from, to);
  }

  return {
    from,
    to,
    closeOpenSegment: true,
    openSegmentType:
      to === 'active'
        ? 'focused'
        : to === 'paused'
          ? 'paused'
          : to === 'waiting'
            ? 'waiting'
            : null,
    terminal: to === 'completed' || to === 'stopped',
    noop: false,
  };
}

export interface FocusSegment {
  type: FocusSegmentType;
  startedAt: Date;
  endedAt: Date | null;
}

export function focusedDurationMilliseconds(
  segments: readonly FocusSegment[],
  now: Date,
): number {
  if (Number.isNaN(now.getTime())) throw new RangeError('Now must be valid.');

  const ordered = [...segments].sort(
    (left, right) => left.startedAt.getTime() - right.startedAt.getTime(),
  );
  let previousEnd = Number.NEGATIVE_INFINITY;
  let total = 0;

  for (const [index, segment] of ordered.entries()) {
    const start = segment.startedAt.getTime();
    const end = segment.endedAt?.getTime() ?? now.getTime();
    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      end < start ||
      start < previousEnd ||
      (!segment.endedAt && index !== ordered.length - 1) ||
      end > now.getTime()
    ) {
      throw new RangeError(
        'Focus segments must be valid, ordered, non-overlapping, and not in the future.',
      );
    }
    if (segment.type === 'focused') total += end - start;
    previousEnd = end;
  }

  return total;
}
