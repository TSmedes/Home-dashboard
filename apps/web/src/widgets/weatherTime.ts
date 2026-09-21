import type { WeatherHour } from "@home-dash/shared";

/**
 * Open-Meteo is asked for data in the dashboard's timezone and returns bare
 * local wall-clock strings ("2026-09-21T12:00") with no offset. Anything that
 * compares those against a UTC-derived value silently shows the wrong hours -
 * so "now" has to be expressed in the same local terms.
 */
export function localHourKey(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}`;
}

/** The next `count` hours from now, not from the start of the returned day. */
export function upcoming(
  hourly: WeatherHour[],
  count: number,
  now: Date,
  timezone: string,
): WeatherHour[] {
  if (hourly.length === 0) return [];
  const key = localHourKey(now, timezone);
  const index = hourly.findIndex((hour) => hour.time.slice(0, 13) >= key);
  return hourly.slice(index === -1 ? 0 : index, (index === -1 ? 0 : index) + count);
}

export function hourLabel(iso: string, clock: "12h" | "24h"): string {
  const hour = Number(iso.slice(11, 13));
  if (clock === "24h") return String(hour).padStart(2, "0");
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/** Compact time that still says morning or evening - sunrise and sunset sit together. */
export function shortClock(iso: string, clock: "12h" | "24h"): string {
  const hour = Number(iso.slice(11, 13));
  const minute = iso.slice(14, 16);
  if (clock === "24h") return `${String(hour).padStart(2, "0")}:${minute}`;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${minute}${hour < 12 ? "a" : "p"}`;
}
