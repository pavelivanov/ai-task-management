export const TASK_STATUSES = [
  'inbox',
  'backlog',
  'planned',
  'in_progress',
  'waiting',
  'blocked',
  'completed',
  'cancelled',
  'archived',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_CATEGORIES = ['work', 'personal'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_TITLE_MAX_LENGTH = 240;
export const TASK_DESCRIPTION_MAX_LENGTH = 10_000;
export const TASK_ESTIMATE_MINUTES_MIN = 1;
export const TASK_ESTIMATE_MINUTES_MAX = 10_080;

export type TaskTransitionEventType =
  | 'updated'
  | 'scheduled'
  | 'unscheduled'
  | 'started'
  | 'paused'
  | 'resumed'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'cancelled'
  | 'archived';

export interface TaskTransition {
  from: TaskStatus;
  to: TaskStatus;
  eventType: TaskTransitionEventType;
}

export class TaskTransitionError extends Error {
  readonly code: 'TASK_TRANSITION_NOOP' | 'TASK_TRANSITION_UNSUPPORTED';

  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    const noOp = from === to;
    super(
      noOp
        ? `Task is already ${to}.`
        : `Task cannot transition from ${from} to ${to}.`,
    );
    this.name = 'TaskTransitionError';
    this.code = noOp ? 'TASK_TRANSITION_NOOP' : 'TASK_TRANSITION_UNSUPPORTED';
  }
}

const transitionTargets = {
  inbox: ['backlog', 'planned', 'archived', 'cancelled'],
  backlog: ['planned', 'in_progress', 'archived', 'cancelled'],
  planned: ['in_progress', 'backlog', 'completed', 'cancelled'],
  in_progress: ['waiting', 'blocked', 'completed', 'backlog'],
  waiting: ['in_progress', 'blocked', 'completed', 'backlog'],
  blocked: ['in_progress', 'backlog', 'cancelled', 'completed'],
  completed: [],
  cancelled: [],
  archived: [],
} as const satisfies Record<TaskStatus, readonly TaskStatus[]>;

export const TASK_TRANSITION_TARGETS: Readonly<
  Record<TaskStatus, readonly TaskStatus[]>
> = transitionTargets;

export const TERMINAL_TASK_STATUSES = [
  'completed',
  'cancelled',
  'archived',
] as const satisfies readonly TaskStatus[];

function eventTypeForTransition(
  from: TaskStatus,
  to: TaskStatus,
): TaskTransitionEventType {
  if (to === 'planned') return 'scheduled';
  if (to === 'waiting') return 'waiting';
  if (to === 'blocked') return 'blocked';
  if (to === 'completed') return 'completed';
  if (to === 'cancelled') return 'cancelled';
  if (to === 'archived') return 'archived';
  if (to === 'in_progress') {
    return from === 'waiting' || from === 'blocked' ? 'resumed' : 'started';
  }
  if (to === 'backlog') {
    if (from === 'planned') return 'unscheduled';
    if (from === 'in_progress' || from === 'waiting' || from === 'blocked') {
      return 'paused';
    }
  }
  return 'updated';
}

export function transitionTaskStatus(
  from: TaskStatus,
  to: TaskStatus,
): TaskTransition {
  const targets = TASK_TRANSITION_TARGETS[from];
  if (!targets.includes(to)) {
    throw new TaskTransitionError(from, to);
  }

  return { from, to, eventType: eventTypeForTransition(from, to) };
}

export function validateTaskTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length === 0 || normalized.length > TASK_TITLE_MAX_LENGTH) {
    throw new RangeError(
      `Task title must contain 1-${TASK_TITLE_MAX_LENGTH} characters.`,
    );
  }
  return normalized;
}

export function validateTaskDescription(
  description: string | null | undefined,
): string | null {
  if (description === null || description === undefined) return null;
  const normalized = description.trim();
  if (normalized.length > TASK_DESCRIPTION_MAX_LENGTH) {
    throw new RangeError(
      `Task description must contain at most ${TASK_DESCRIPTION_MAX_LENGTH} characters.`,
    );
  }
  return normalized.length === 0 ? null : normalized;
}

export function validateTaskEstimate(
  estimateMinutes: number | null | undefined,
): number | null {
  if (estimateMinutes === null || estimateMinutes === undefined) return null;
  if (
    !Number.isInteger(estimateMinutes) ||
    estimateMinutes < TASK_ESTIMATE_MINUTES_MIN ||
    estimateMinutes > TASK_ESTIMATE_MINUTES_MAX
  ) {
    throw new RangeError(
      `Task estimate must be an integer between ${TASK_ESTIMATE_MINUTES_MIN} and ${TASK_ESTIMATE_MINUTES_MAX} minutes.`,
    );
  }
  return estimateMinutes;
}

export function validateTaskDueAt(dueAt: Date | null | undefined): Date | null {
  if (dueAt === null || dueAt === undefined) return null;
  if (Number.isNaN(dueAt.getTime())) {
    throw new RangeError('Task due date must be valid.');
  }
  return dueAt;
}
