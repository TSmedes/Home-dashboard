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
