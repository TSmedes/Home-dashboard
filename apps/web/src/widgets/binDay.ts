import { WEEKDAYS, type BinConfig } from "@home-dash/shared";
import { addDays, dateKey, daysBetween } from "../lib/zoned.js";

export interface Pickup {
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  /** 0 today, 1 tomorrow. */
  daysAway: number;
  /** Moved from its usual day, e.g. by a holiday. */
  moved: boolean;
  /**
   * `out-tonight`: the evening before, when the bin needs taking out.
   * `today`: collection day itself, for anyone who forgot.
   */
  urgency: "today" | "out-tonight" | null;
}

/** From this hour the day before, the pickup is called out. */
export const EVENING_HOUR = 16;

/** Far enough ahead for an eight-weekly bin with a holiday shift. */
const HORIZON_DAYS = 8 * 7 + 14;

const weekdayOf = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay();

function hourIn(at: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(at);
  return Number(hour) % 24;
}

/** Whether `key` is one of this bin's regular collection days. */
function isRegular(bin: BinConfig, key: string): boolean {
  const day = WEEKDAYS.indexOf(bin.day);
  if (weekdayOf(key) !== day) return false;
  if (bin.every === 1 || !bin.anchor) return true;
  // The anchor may be written as any day of a pickup week; line it up with
  // that week's collection day first.
  const aligned = addDays(bin.anchor, day - weekdayOf(bin.anchor));
  const weeks = daysBetween(aligned, key) / 7;
  return ((weeks % bin.every) + bin.every) % bin.every === 0;
}

/** The next collection of one bin on or after `today`, or null if none is in sight. */
export function nextCollection(bin: BinConfig, today: string): { date: string; moved: boolean } | null {
  const movedAway = new Set(bin.moved.map((m) => m.from));
  const skipped = new Set(bin.skip);
  const candidates: { date: string; moved: boolean }[] = bin.moved
    .filter((m) => m.to >= today && !skipped.has(m.to))
    .map((m) => ({ date: m.to, moved: true }));

  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const key = addDays(today, i);
    if (isRegular(bin, key) && !movedAway.has(key) && !skipped.has(key)) {
      candidates.push({ date: key, moved: false });
      break;
    }
  }
  return candidates.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}

/**
 * Whether a pickup is close enough to be worth a tile: the day before, or the
 * day itself. A whole-day window, unlike the `out-tonight` callout, so the
 * reminder is on the wall from breakfast rather than appearing at teatime.
 */
export function binsDueSoon(bins: BinConfig[], now: Date, timezone: string): boolean {
  return upcomingPickups(bins, now, timezone).some((pickup) => pickup.daysAway <= 1);
}

/** Every bin's next pickup, soonest first. */
export function upcomingPickups(bins: BinConfig[], now: Date, timezone: string): Pickup[] {
  const today = dateKey(now, timezone);
  const evening = hourIn(now, timezone) >= EVENING_HOUR;

  return bins
    .flatMap((bin) => {
      const next = nextCollection(bin, today);
      if (!next) return [];
      const daysAway = daysBetween(today, next.date);
      const urgency: Pickup["urgency"] = daysAway === 0 ? "today" : daysAway === 1 && evening ? "out-tonight" : null;
      return [{ name: bin.name, date: next.date, daysAway, moved: next.moved, urgency }];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
