import { z } from "zod";

/**
 * Business hours format (BotSettings.businessHours), times in the tenant timezone:
 *   { "mon": [{ "open": "09:00", "close": "18:00" }], "tue": [...], ... }
 * - Keys mon..sun. An EMPTY object means "always open".
 * - When at least one day is configured, a missing day or an empty array means closed that day.
 * - close <= open means the range runs past midnight (e.g. 18:00 -> 02:00).
 * - "24:00" is accepted as a close time (end of day).
 */
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];
export type TimeRange = { open: string; close: string };
export type BusinessHours = Partial<Record<Day, TimeRange[]>>;

export const DAY_LABELS: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timeRangeSchema = z
  .object({
    open: z.string().regex(HHMM, "Use HH:MM (24h)"),
    close: z.string().refine((s) => HHMM.test(s) || s === "24:00", "Use HH:MM (24h)"),
  })
  .refine((r) => r.open !== r.close, "Open and close times must differ");

export const businessHoursSchema = z
  .object(Object.fromEntries(DAYS.map((d) => [d, z.array(timeRangeSchema).max(4).optional()])) as Record<Day, z.ZodOptional<z.ZodArray<typeof timeRangeSchema>>>)
  .strict();

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Weekday + minutes since midnight in the given IANA timezone. Throws RangeError for an invalid zone. */
export function localDayAndMinutes(timezone: string, now: Date): { day: Day; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday").slice(0, 3).toLowerCase() as Day;
  return { day, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Parses stored JSON. Returns null for anything malformed so callers can decide (isOpenNow treats it as always open). */
export function parseBusinessHours(value: unknown): BusinessHours | null {
  const parsed = businessHoursSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : null;
}

export function isOpenNow(businessHours: unknown, timezone: string, now: Date = new Date()): boolean {
  const hours = parseBusinessHours(businessHours);
  if (!hours || Object.keys(hours).length === 0) return true;

  const { day, minutes } = localDayAndMinutes(timezone, now);
  const prevDay = DAYS[(DAYS.indexOf(day) + 6) % 7];

  for (const r of hours[day] ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (close > open ? minutes >= open && minutes < close : minutes >= open) return true;
  }
  // Overnight ranges that started yesterday and are still running.
  for (const r of hours[prevDay] ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (close <= open && minutes < close) return true;
  }
  return false;
}

/** Human-readable weekly schedule for the bot prompt. */
export function describeBusinessHours(businessHours: unknown): string {
  const hours = parseBusinessHours(businessHours);
  if (!hours || Object.keys(hours).length === 0) return "Open every day, all day.";
  return DAYS.map((d) => {
    const ranges = hours[d] ?? [];
    return `${DAY_LABELS[d]}: ${ranges.length ? ranges.map((r) => `${r.open}-${r.close}`).join(", ") : "closed"}`;
  }).join("\n");
}
