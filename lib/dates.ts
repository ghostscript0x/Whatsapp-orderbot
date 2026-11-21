/**
 * Time-zone aware calendar helpers. Pure functions (no DB, no env) so they are unit-testable.
 * Uses Intl only; no date library.
 */

export type DayRange = {
  /** Local calendar date in the zone, "YYYY-MM-DD". */
  date: string;
  /** Inclusive UTC instant of local midnight. */
  start: Date;
  /** Exclusive UTC instant of the next local midnight (23, 24 or 25 h after start across DST). */
  end: Date;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // Throws RangeError for an unknown zone; callers should not hide that.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (e.g. +3_600_000 for Africa/Lagos). */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - wholeSeconds;
}

/**
 * UTC instant of 00:00 local time on the given local calendar date. If midnight does not exist
 * (a DST jump at midnight), returns the first instant of that day.
 */
function localMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const naive = Date.UTC(year, month - 1, day);
  // Two passes settle the offset across a DST boundary near midnight.
  let guess = naive - timeZoneOffsetMs(new Date(naive), timeZone);
  guess = naive - timeZoneOffsetMs(new Date(guess), timeZone);
  const w = wallClock(new Date(guess), timeZone);
  // If local midnight does not exist (DST gap at 00:00, e.g. America/Santiago), the guess lands
  // on the previous evening; the day really starts where the gap ends, one hour later.
  const landedOnPreviousDay = Date.UTC(w.year, w.month - 1, w.day) < naive;
  return new Date(landedOnPreviousDay ? guess + 3_600_000 : guess);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** The local calendar day containing `now` in `timeZone`, as a UTC [start, end) range. */
export function dayRangeInTimeZone(timeZone: string, now: Date = new Date()): DayRange {
  const w = wallClock(now, timeZone);
  const start = localMidnightUtc(w.year, w.month, w.day, timeZone);
  const next = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  const end = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
  return { date: `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`, start, end };
}

/** True if `timeZone` is an IANA zone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}
