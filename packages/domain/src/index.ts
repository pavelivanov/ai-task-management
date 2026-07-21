export * from './behavior/index.js';
export * from './daily-plans/index.js';
export * from './focus/index.js';
export * from './reviews/index.js';
export * from './tasks/index.js';

export function normalizeMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) {
    throw new TypeError('Minutes must be a finite number.');
  }

  return Math.max(0, Math.round(minutes));
}
