/**
 * Calendar maths in an IANA timezone, without a date library.
 *
 * The server runs in UTC inside Docker, so "the start of today" has to be
 * worked out for the dashboard's timezone explicitly - using the host's local
 * time would put the day boundary at 5pm in Los Angeles.
 */

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = partsFormatter.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsFormatter.set(timezone, formatter);
  }
  return formatter;
}

function wallClock(at: Date, timezone: string) {
  const parts = formatterFor(timezone).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timezone` from UTC at instant `at`, in milliseconds. */
function offsetMs(at: Date, timezone: string): number {
  const w = wallClock(at, timezone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** YYYY-MM-DD for the local date at `at` in `timezone`. */
export function dateKeyInZone(at: Date, timezone: string): string {
  const w = wallClock(at, timezone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Calendar-date arithmetic on YYYY-MM-DD keys; no timezone involved. */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The instant at which `timezone`'s wall clock reads the given time.
 *
 * Guesses using the offset at the naive UTC reading, then corrects once for the
 * offset at the guessed instant, which settles every case except the hour that
 * does not exist at spring-forward; that resolves to a neighbouring real instant.
 */
export function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = naive - offsetMs(new Date(naive), timezone);
  const second_ = naive - offsetMs(new Date(first), timezone);
  return new Date(second_);
}

/** Local midnight at the start of `dateKey` in `timezone`, as an instant. */
export function zonedMidnight(dateKey: string, timezone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return wallTimeToInstant(y, m, d, 0, 0, 0, timezone);
}
