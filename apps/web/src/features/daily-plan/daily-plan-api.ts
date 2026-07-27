import {
  type DailyPlan,
  type DailyPlanRole,
  dailyPlanSchema,
  type ResolveCarryover,
} from '@execution/contracts';

import { apiRequest, jsonBody } from '../../lib/api-client';

export function getTodayPlan(): Promise<DailyPlan> {
  return apiRequest('/daily-plans/today', dailyPlanSchema);
}

export function createTodayPlan(): Promise<DailyPlan> {
  return apiRequest('/daily-plans/today', dailyPlanSchema, {
    method: 'POST',
    ...jsonBody({}),
  });
}

export function addPlanItem(input: {
  taskId: string;
  role: DailyPlanRole;
  expectedPlanVersion: number;
  plannedDurationMinutes?: number;
}): Promise<DailyPlan> {
  return apiRequest('/daily-plans/today/items', dailyPlanSchema, {
    method: 'POST',
    ...jsonBody(input),
  });
}

export function movePlanItem(
  itemId: string,
  expectedPlanVersion: number,
  position: number,
): Promise<DailyPlan> {
  return apiRequest(`/daily-plans/today/items/${itemId}`, dailyPlanSchema, {
    method: 'PATCH',
    ...jsonBody({ expectedPlanVersion, position }),
  });
}

export function updatePlanItem(
  itemId: string,
  expectedPlanVersion: number,
  patch: {
    role?: DailyPlanRole;
    plannedDurationMinutes?: number | null;
  },
): Promise<DailyPlan> {
  return apiRequest(`/daily-plans/today/items/${itemId}`, dailyPlanSchema, {
    method: 'PATCH',
    ...jsonBody({ expectedPlanVersion, ...patch }),
  });
}

export function removePlanItem(
  itemId: string,
  expectedPlanVersion: number,
): Promise<DailyPlan> {
  const query = new URLSearchParams({
    expectedPlanVersion: String(expectedPlanVersion),
  });
  return apiRequest(
    `/daily-plans/today/items/${itemId}?${query.toString()}`,
    dailyPlanSchema,
    { method: 'DELETE' },
  );
}

export function closeTodayPlan(
  expectedPlanVersion: number,
): Promise<DailyPlan> {
  return apiRequest('/daily-plans/today/close', dailyPlanSchema, {
    method: 'POST',
    ...jsonBody({ expectedPlanVersion }),
  });
}

export function resolveCarryover(
  taskId: string,
  input: ResolveCarryover,
): Promise<DailyPlan> {
  return apiRequest(
    `/daily-plans/today/carryovers/${taskId}/resolve`,
    dailyPlanSchema,
    {
      method: 'POST',
      ...jsonBody(input),
    },
  );
}
