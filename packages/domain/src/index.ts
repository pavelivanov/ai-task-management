export function normalizeMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) {
    throw new TypeError('Minutes must be a finite number.');
  }

  return Math.max(0, Math.round(minutes));
}
