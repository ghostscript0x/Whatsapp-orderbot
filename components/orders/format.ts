/** Display helpers for the dashboard (browser locale/time zone). Shared by orders, conversations and products. */

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const dayFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const longDayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const formatDateTime = (iso: string | Date) => dateTimeFmt.format(new Date(iso));
export const formatTime = (iso: string | Date) => timeFmt.format(new Date(iso));

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days between `d` and `now` (0 = today, 1 = yesterday). */
export function daysAgo(iso: string | Date, now = new Date()): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY);
}

/** Chat-list style: today "14:05", yesterday "Yesterday", this week "Monday", older "3 Nov". */
export function formatShortTime(iso: string | Date, now = new Date()): string {
  const d = new Date(iso);
  const days = daysAgo(d, now);
  if (days <= 0) return timeFmt.format(d);
  if (days === 1) return "Yesterday";
  if (days < 7) return weekdayFmt.format(d);
  return dayFmt.format(d);
}

/** "Just now", "5 min. ago", "3 hr. ago", "yesterday", then a date. */
export function formatRelative(iso: string | Date, now = new Date()): string {
  const d = new Date(iso);
  const diff = now.getTime() - d.getTime();
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) return relFmt.format(-Math.floor(diff / MINUTE), "minute");
  if (diff < 12 * HOUR) return relFmt.format(-Math.floor(diff / HOUR), "hour");
  const days = daysAgo(d, now);
  if (days === 0) return `Today, ${timeFmt.format(d)}`;
  if (days === 1) return `Yesterday, ${timeFmt.format(d)}`;
  return dateTimeFmt.format(d);
}

/** Separator label in a chat: "Today", "Yesterday", "Mon, 3 Nov 2026". */
export function formatDayLabel(iso: string | Date, now = new Date()): string {
  const days = daysAgo(iso, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return longDayFmt.format(new Date(iso));
}

export const formatPhone = (digits: string) => `+${digits}`;

/** wa.me link for a phone stored as digits with country code. */
export const whatsappLink = (digits: string) => `https://wa.me/${digits.replace(/\D/g, "")}`;

/** "Ada Lovelace" -> "AL", "+2348012345678" -> "78". */
export function initials(name: string | null, phone: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return phone.slice(-2);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
