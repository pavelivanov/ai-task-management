export const DAILY_PLAN_ROLES = ['primary', 'secondary', 'optional'] as const;
export type DailyPlanRole = (typeof DAILY_PLAN_ROLES)[number];

export interface PlanningItem {
  id: string;
  taskId: string;
  role: DailyPlanRole;
  position: number;
  plannedDurationMinutes: number | null;
  taskEstimateMinutes: number | null;
}

export interface PlanningLimits {
  primaryLimit: number;
  secondaryLimit: number;
  overCapacityPercent: number;
}

export const DEFAULT_PLANNING_LIMITS: PlanningLimits = {
  primaryLimit: 1,
  secondaryLimit: 2,
  overCapacityPercent: 10,
};

export type PlanningWarning =
  | {
      code: 'MULTIPLE_PRIMARY';
      data: { count: number; limit: number };
    }
  | {
      code: 'TOO_MANY_SECONDARY';
      data: { count: number; limit: number };
    }
  | {
      code: 'MISSING_ESTIMATE';
      data: { taskIds: string[] };
    }
  | {
      code: 'OVER_CAPACITY';
      data: {
        availableMinutes: number;
        scheduledMinutes: number;
        thresholdPercent: number;
      };
    };

export interface PlanAnalysis {
  availableMinutes: number;
  scheduledMinutes: number;
  roleCounts: Record<DailyPlanRole, number>;
  warnings: PlanningWarning[];
  orderedItems: PlanningItem[];
}

export interface CarryoverThresholds {
  warning: number;
  diagnosis: number;
  explicitChoice: number;
}

export const DEFAULT_CARRYOVER_THRESHOLDS: CarryoverThresholds = {
  warning: 2,
  diagnosis: 3,
  explicitChoice: 5,
};

export type CarryoverSignal = 'warning' | 'diagnosis' | 'explicit_choice';

function parseLocalTime(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new RangeError('Expected a local time in HH:mm format.');
  return Number(match[1]) * 60 + Number(match[2]);
}

export function availableWorkMinutes(start: string, end: string): number {
  const startMinutes = parseLocalTime(start);
  const endMinutes = parseLocalTime(end);
  if (endMinutes <= startMinutes) {
    throw new RangeError('Workday end must be after workday start.');
  }
  return endMinutes - startMinutes;
}

export function orderPlanningItems<
  T extends Pick<PlanningItem, 'id' | 'position'>,
>(items: readonly T[]): T[] {
  return [...items].sort(
    (left, right) =>
      left.position - right.position || left.id.localeCompare(right.id),
  );
}

export function analyzePlan(
  workdayStart: string,
  workdayEnd: string,
  items: readonly PlanningItem[],
  limits: Partial<PlanningLimits> = {},
): PlanAnalysis {
  const configuration = { ...DEFAULT_PLANNING_LIMITS, ...limits };
  if (
    !Number.isInteger(configuration.primaryLimit) ||
    configuration.primaryLimit < 0 ||
    !Number.isInteger(configuration.secondaryLimit) ||
    configuration.secondaryLimit < 0 ||
    !Number.isFinite(configuration.overCapacityPercent) ||
    configuration.overCapacityPercent < 0
  ) {
    throw new RangeError('Planning limits must be non-negative.');
  }

  const availableMinutes = availableWorkMinutes(workdayStart, workdayEnd);
  const orderedItems = orderPlanningItems(items);
  const roleCounts: Record<DailyPlanRole, number> = {
    primary: 0,
    secondary: 0,
    optional: 0,
  };
  const missingEstimateTaskIds: string[] = [];
  let scheduledMinutes = 0;

  for (const item of orderedItems) {
    roleCounts[item.role] += 1;
    const duration =
      item.plannedDurationMinutes ?? item.taskEstimateMinutes ?? null;
    if (duration === null) {
      missingEstimateTaskIds.push(item.taskId);
    } else {
      scheduledMinutes += duration;
    }
  }

  const warnings: PlanningWarning[] = [];
  if (roleCounts.primary > configuration.primaryLimit) {
    warnings.push({
      code: 'MULTIPLE_PRIMARY',
      data: {
        count: roleCounts.primary,
        limit: configuration.primaryLimit,
      },
    });
  }
  if (roleCounts.secondary > configuration.secondaryLimit) {
    warnings.push({
      code: 'TOO_MANY_SECONDARY',
      data: {
        count: roleCounts.secondary,
        limit: configuration.secondaryLimit,
      },
    });
  }
  if (missingEstimateTaskIds.length > 0) {
    warnings.push({
      code: 'MISSING_ESTIMATE',
      data: { taskIds: missingEstimateTaskIds },
    });
  }
  if (
    scheduledMinutes >
    availableMinutes * (1 + configuration.overCapacityPercent / 100)
  ) {
    warnings.push({
      code: 'OVER_CAPACITY',
      data: {
        availableMinutes,
        scheduledMinutes,
        thresholdPercent: configuration.overCapacityPercent,
      },
    });
  }

  return {
    availableMinutes,
    scheduledMinutes,
    roleCounts,
    warnings,
    orderedItems,
  };
}

export function localDateForInstant(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError('Instant must be valid.');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export function validateLocalDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('Expected a local date in YYYY-MM-DD format.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError('Expected a valid Gregorian date.');
  }
  return value;
}

export function carryoverSignalForCount(
  count: number,
  thresholds: Partial<CarryoverThresholds> = {},
): CarryoverSignal | null {
  const configuration = { ...DEFAULT_CARRYOVER_THRESHOLDS, ...thresholds };
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    !Number.isInteger(configuration.warning) ||
    !Number.isInteger(configuration.diagnosis) ||
    !Number.isInteger(configuration.explicitChoice) ||
    configuration.warning < 1 ||
    configuration.warning >= configuration.diagnosis ||
    configuration.diagnosis >= configuration.explicitChoice
  ) {
    throw new RangeError('Carryover counts and thresholds are invalid.');
  }
  if (count >= configuration.explicitChoice) return 'explicit_choice';
  if (count >= configuration.diagnosis) return 'diagnosis';
  if (count >= configuration.warning) return 'warning';
  return null;
}
