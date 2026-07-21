import {
  localDateForInstant,
  validateLocalDate,
} from '../daily-plans/index.js';

const PRIORITY_ORDER = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
} as const;

export interface ProtectedHoursInput {
  now: Date;
  timeZone: string;
  enabled: boolean;
  start: string | null;
  end: string | null;
}

export interface ProtectedTaskInput {
  category: 'work' | 'personal';
  priority: 'low' | 'normal' | 'high' | 'critical';
  plannedPersonalAdmin: boolean;
}

export interface ProtectedStartDecision {
  protectedNow: boolean;
  confirmationRequired: boolean;
  reason:
    | 'outside_protected_hours'
    | 'work'
    | 'urgent'
    | 'planned_admin'
    | 'personal';
}

export interface WaitingCandidate {
  id: string;
  category: 'work' | 'personal';
  status: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  estimateMinutes: number | null;
  dueAt: Date | null;
  createdAt: Date;
  optionalPlanItem: boolean;
}

function parseLocalTime(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new RangeError('Expected a local time in HH:mm format.');
  return Number(match[1]) * 60 + Number(match[2]);
}

export function localMinuteForInstant(instant: Date, timeZone: string): number {
  if (Number.isNaN(instant.getTime()))
    throw new RangeError('Instant must be valid.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return Number(values.hour) * 60 + Number(values.minute);
}

export function isInsideProtectedHours(input: ProtectedHoursInput): boolean {
  if (!input.enabled || input.start === null || input.end === null)
    return false;
  const start = parseLocalTime(input.start);
  const end = parseLocalTime(input.end);
  if (end <= start)
    throw new RangeError('Protected-hour end must be after start.');
  const minute = localMinuteForInstant(input.now, input.timeZone);
  return minute >= start && minute < end;
}

export function evaluateProtectedStart(
  hours: ProtectedHoursInput,
  task: ProtectedTaskInput,
): ProtectedStartDecision {
  const protectedNow = isInsideProtectedHours(hours);
  if (!protectedNow) {
    return {
      protectedNow,
      confirmationRequired: false,
      reason: 'outside_protected_hours',
    };
  }
  if (task.category === 'work') {
    return { protectedNow, confirmationRequired: false, reason: 'work' };
  }
  if (task.priority === 'critical') {
    return { protectedNow, confirmationRequired: false, reason: 'urgent' };
  }
  if (task.plannedPersonalAdmin) {
    return {
      protectedNow,
      confirmationRequired: false,
      reason: 'planned_admin',
    };
  }
  return { protectedNow, confirmationRequired: true, reason: 'personal' };
}

export function zonedLocalDateTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const validatedDate = validateLocalDate(date);
  const minute = parseLocalTime(time);
  const [year, month, day] = validatedDate.split('-').map(Number);
  const desiredAsUtc = Date.UTC(
    year ?? 0,
    (month ?? 1) - 1,
    day ?? 1,
    Math.floor(minute / 60),
    minute % 60,
  );
  let candidate = desiredAsUtc;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    const delta = desiredAsUtc - representedAsUtc;
    if (delta === 0) return new Date(candidate);
    candidate += delta;
  }

  throw new RangeError('The local time does not exist in this timezone.');
}

export function scheduleAfterProtectedHours(input: ProtectedHoursInput): Date {
  if (!input.enabled || input.end === null) {
    throw new RangeError('Protected hours must be enabled with an end time.');
  }
  return zonedLocalDateTimeToInstant(
    localDateForInstant(input.now, input.timeZone),
    input.end,
    input.timeZone,
  );
}

export function selectWaitingCandidates<T extends WaitingCandidate>(
  tasks: readonly T[],
  expectedWaitMinutes: number,
  protectedNow: boolean,
): T[] {
  if (!Number.isInteger(expectedWaitMinutes) || expectedWaitMinutes < 5) {
    throw new RangeError('Expected wait must be at least five minutes.');
  }
  return [...tasks]
    .filter(
      (task) =>
        (task.status === 'backlog' || task.optionalPlanItem) &&
        task.estimateMinutes !== null &&
        task.estimateMinutes <= expectedWaitMinutes &&
        (!protectedNow || task.category === 'work'),
    )
    .sort(
      (left, right) =>
        PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
        (left.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) -
          (right.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
        left.estimateMinutes! - right.estimateMinutes! ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 3);
}

export function triggerDedupeKey(
  type: string,
  userId: string,
  window: string,
  relatedResourceId?: string,
): string {
  const parts = [type, userId, window, relatedResourceId].filter(Boolean);
  return parts.join(':');
}
