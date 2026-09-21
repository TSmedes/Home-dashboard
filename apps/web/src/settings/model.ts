import type { ConfigChange, Profile, ProfileOverride } from "@home-dash/shared";
import { clockTime, dateKey } from "../lib/zoned.js";

export const profileLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

/**
 * The edits for moving when `name` starts. The profile that used to end at the
 * old start time ends at the new one instead, so the day stays covered with no
 * gap (where nothing would match) and no overlap (where the first would win).
 */
export function scheduleChanges(profiles: Record<string, Profile>, name: string, from: string): ConfigChange[] {
  const current = profiles[name];
  if (!current || current.schedule.from === from) return [];

  const clash = Object.entries(profiles).find(([other, p]) => other !== name && p.schedule.from === from);
  if (clash) {
    throw new Error(`${profileLabel(name)} and ${profileLabel(clash[0]).toLowerCase()} can't start at the same time.`);
  }

  const changes: ConfigChange[] = [{ path: ["profiles", name, "schedule", "from"], value: from }];
  for (const [other, profile] of Object.entries(profiles)) {
    if (other !== name && profile.schedule.to === current.schedule.from) {
      changes.push({ path: ["profiles", other, "schedule", "to"], value: from });
    }
  }
  return changes;
}

/** One line for the top of settings: what is showing, and for how long. */
export function overrideSummary(
  override: ProfileOverride | null,
  activeProfile: string,
  now: Date,
  timezone: string,
  clock: "12h" | "24h",
): string {
  if (!override) return `Showing the ${activeProfile} screen, on schedule.`;

  const until = new Date(override.until);
  const { time, meridiem } = clockTime(until, timezone, clock);
  const tomorrow = dateKey(until, timezone) !== dateKey(now, timezone) ? " tomorrow" : "";
  return `Showing the ${override.profile} screen until ${meridiem ? `${time} ${meridiem}` : time}${tomorrow}, then back on schedule.`;
}

/** Rough age for the status list, e.g. "2 min ago". */
export function ago(iso: string, now: Date): string {
  const seconds = (now.getTime() - Date.parse(iso)) / 1000;
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
