import {
  localDateForInstant,
  validateLocalDate,
} from '../daily-plans/index.js';

const SEARCH_WINDOW_MILLISECONDS = 36 * 60 * 60 * 1_000;

function nextLocalDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function startOfLocalDateUtc(date: string, timezone: string): Date {
  const validated = validateLocalDate(date);
  const anchor = Date.parse(`${validated}T00:00:00.000Z`);
  let low = anchor - SEARCH_WINDOW_MILLISECONDS;
  let high = anchor + SEARCH_WINDOW_MILLISECONDS;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDateForInstant(new Date(middle), timezone) < validated) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const result = new Date(low);
  if (localDateForInstant(result, timezone) !== validated) {
    throw new RangeError(
      'The local date could not be resolved in this timezone.',
    );
  }
  return result;
}

export function localDateBoundsUtc(
  date: string,
  timezone: string,
): { start: Date; end: Date } {
  const validated = validateLocalDate(date);
  return {
    start: startOfLocalDateUtc(validated, timezone),
    end: startOfLocalDateUtc(nextLocalDate(validated), timezone),
  };
}

export function overlapDurationMilliseconds(
  startedAt: Date,
  endedAt: Date,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  const startedAtMilliseconds = startedAt.getTime();
  const endedAtMilliseconds = endedAt.getTime();
  const rangeStartMilliseconds = rangeStart.getTime();
  const rangeEndMilliseconds = rangeEnd.getTime();
  const values = [
    startedAtMilliseconds,
    endedAtMilliseconds,
    rangeStartMilliseconds,
    rangeEndMilliseconds,
  ];
  if (values.some(Number.isNaN)) throw new RangeError('Dates must be valid.');
  if (
    endedAtMilliseconds < startedAtMilliseconds ||
    rangeEndMilliseconds <= rangeStartMilliseconds
  ) {
    throw new RangeError('Date ranges must be ordered.');
  }
  return Math.max(
    0,
    Math.min(endedAtMilliseconds, rangeEndMilliseconds) -
      Math.max(startedAtMilliseconds, rangeStartMilliseconds),
  );
}
