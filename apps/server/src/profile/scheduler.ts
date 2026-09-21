import type { Profile } from "@home-dash/shared";
import { addDays, dateKeyInZone, wallTimeToInstant } from "../lib/zonedTime.js";

/**
 * Minutes past local midnight for `at`, in the given IANA zone.
 *
 * Uses Intl rather than a date library so DST is handled by the platform's
 * own tz database — no offset arithmetic to get wrong twice a year.
 */
export function minutesInZone(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Whether `minutes` falls in [from, to). A window whose start is after its end
 * wraps past midnight, which is how the night profile is normally written
 * (21:30 -> 06:30).
 */
export function isWithinWindow(minutes: number, from: string, to: string): boolean {
  const start = toMinutes(from);
  const end = toMinutes(to);
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

/**
 * The next moment, strictly after `at`, at which any profile's window opens -
 * the next scheduled switch. A manual override lasts until then.
 */
export function nextBoundary(profiles: Record<string, Profile>, at: Date, timezone: string): Date {
  const today = dateKeyInZone(at, timezone);
  let soonest = Number.POSITIVE_INFINITY;

  for (const profile of Object.values(profiles)) {
    const [hour, minute] = profile.schedule.from.split(":").map(Number) as [number, number];
    for (const day of [today, addDays(today, 1)]) {
      const [y, m, d] = day.split("-").map(Number) as [number, number, number];
      const candidate = wallTimeToInstant(y, m, d, hour, minute, 0, timezone).getTime();
      if (candidate > at.getTime()) {
        soonest = Math.min(soonest, candidate);
        break;
      }
    }
  }
  if (!Number.isFinite(soonest)) throw new Error("no profiles configured");
  return new Date(soonest);
}

/**
 * The profile that should be showing at `at`.
 *
 * Overlaps resolve to whichever profile is declared first in config.yaml, and
 * a time matching no window falls back to the first profile — the dashboard
 * must always render something, even if the schedule has a gap in it.
 */
export function resolveActiveProfile(
  profiles: Record<string, Profile>,
  at: Date,
  timezone: string,
): string {
  const names = Object.keys(profiles);
  if (names.length === 0) throw new Error("no profiles configured");

  const minutes = minutesInZone(at, timezone);
  for (const name of names) {
    const { from, to } = profiles[name]!.schedule;
    if (isWithinWindow(minutes, from, to)) return name;
  }
  return names[0]!;
}
