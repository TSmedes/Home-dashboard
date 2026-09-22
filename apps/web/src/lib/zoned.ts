/**
 * Date helpers in the dashboard's timezone. The iPad's own timezone is never
 * consulted, so a tablet left on the wrong zone still shows the right day.
 */

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD for the local date at `at` in `timezone`. */
export function dateKey(at: Date, timezone: string): string {
  let formatter = dateFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timezone, formatter);
  }
  return formatter.format(at);
}

/** Calendar-date arithmetic on YYYY-MM-DD keys; no timezone involved. */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Noon UTC on a calendar date: formatting it in UTC always names the right day. */
export function noonOf(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

export function clockTime(at: Date, timezone: string, clock: "12h" | "24h"): { time: string; meridiem: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: clock === "12h" ? "numeric" : "2-digit",
    minute: "2-digit",
    hourCycle: clock === "12h" ? "h12" : "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    time: `${get("hour")}:${get("minute")}`,
    meridiem: clock === "12h" ? get("dayPeriod").toLowerCase() : "",
  };
}

/**
 * How far off a date is, the way people say it: "Today", "Tomorrow", a
 * weekday within the week ahead, then a short date. Both keys YYYY-MM-DD.
 */
export function dayLabel(key: string, today: string): string {
  const days = daysBetween(today, key);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const date = noonOf(key);
  if (days > 1 && days < 7) return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

/** `dayLabel` for the middle of a sentence: "peak tomorrow", "peak Friday". */
export function dayPhrase(key: string, today: string): string {
  const label = dayLabel(key, today);
  return label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label;
}

/** How far `timezone` is ahead of UTC at `at`, in milliseconds. */
function offsetAt(at: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant a calendar date (YYYY-MM-DD) begins in `timezone`. */
export function zonedMidnight(key: string, timezone: string): number {
  const utc = Date.parse(`${key}T00:00:00Z`);
  // Twice, in case the first guess lands on the other side of a clock change.
  const first = utc - offsetAt(utc, timezone);
  return utc - offsetAt(first, timezone);
}
