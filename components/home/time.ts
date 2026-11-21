/** Server-side "x ago" labels for the home lists, using the tenant's time zone for older dates. */
export function timeAgo(iso: string, timeZone: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", timeZone }).format(new Date(iso));
}

/** "Good morning" etc. for the tenant's local time. */
export function greeting(timeZone: string, now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
