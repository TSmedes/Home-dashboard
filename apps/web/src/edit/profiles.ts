import type { DashboardConfig, Profile } from "@home-dash/shared";

/**
 * Adding and removing the screens a dashboard switches between.
 *
 * The one thing that has to stay true is that the profiles' windows cover the
 * whole day exactly once: a gap leaves the wall showing nothing, and an
 * overlap leaves it showing whichever the server happened to check first.
 * Nothing on the server enforces that - it takes the first window that
 * matches - so it is enforced here, and the test walks all 1440 minutes.
 */

/** The smallest slice worth having, and what a split rounds to. */
const STEP = 15;
const DAY = 24 * 60;

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

export const toClock = (minutes: number): string => {
  const wrapped = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
};

/** How long a window lasts, counting one that wraps past midnight. */
export function windowLength(from: string, to: string): number {
  const length = (toMinutes(to) - toMinutes(from) + DAY) % DAY;
  // A window that starts and ends at the same time is the whole day, which is
  // what a single profile's looks like.
  return length === 0 ? DAY : length;
}

/** A name not already taken, so a second evening screen does not overwrite the first. */
export function uniqueProfileName(profiles: Record<string, Profile>, seed: string): string {
  const base = seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile";
  if (!profiles[base]) return base;
  for (let n = 2; ; n += 1) {
    const name = `${base}-${n}`;
    if (!profiles[name]) return name;
  }
}

/** The profile with the most of the day to give away, and how much it has. */
function longest(profiles: Record<string, Profile>): { name: string; profile: Profile; length: number } | null {
  let best: { name: string; profile: Profile; length: number } | null = null;
  for (const [name, profile] of Object.entries(profiles)) {
    const length = windowLength(profile.schedule.from, profile.schedule.to);
    if (!best || length > best.length) best = { name, profile, length };
  }
  return best;
}

/** Whether there is room to fit another screen into the day. */
export function canAddProfile(config: DashboardConfig): boolean {
  const donor = longest(config.profiles);
  return donor !== null && donor.length >= STEP * 2;
}

/**
 * Add a screen by halving the longest window.
 *
 * Taking the time from the profile that has most of it is the choice least
 * likely to matter: splitting a fifteen-hour day screen leaves two long
 * screens, where taking it off a short night screen would leave a sliver.
 *
 * The new screen starts with a clock, because a screen with nothing on it is
 * a blank wall if the schedule reaches it before anyone adds to it.
 */
export function addProfile(config: DashboardConfig, seed = "new"): DashboardConfig {
  const donor = longest(config.profiles);
  if (!donor || donor.length < STEP * 2) return config;

  const start = toMinutes(donor.profile.schedule.from);
  const half = Math.round(donor.length / 2 / STEP) * STEP;
  const split = toClock(start + Math.min(Math.max(half, STEP), donor.length - STEP));
  const name = uniqueProfileName(config.profiles, seed);

  return {
    ...config,
    profiles: {
      ...config.profiles,
      [donor.name]: { ...donor.profile, schedule: { ...donor.profile.schedule, to: split } },
      [name]: {
        schedule: { from: split, to: donor.profile.schedule.to },
        theme: donor.profile.theme,
        returnToFirstPage: donor.profile.returnToFirstPage,
        widgets: [
          {
            id: "clock",
            type: "clock",
            enabled: true,
            page: 1,
            options: {},
            grid: { col: 1, row: 1, colSpan: 12, rowSpan: 6, share: false },
          },
        ],
      },
    },
  };
}

/**
 * Remove a screen, giving its time to whichever ran before it.
 *
 * The day has to stay covered, so the window cannot simply disappear. The
 * profile that ended where this one began is the one that gets it - it is the
 * one whose screen was showing a moment earlier, so extending it is the change
 * nobody notices.
 */
export function removeProfile(config: DashboardConfig, name: string): DashboardConfig {
  const going = config.profiles[name];
  // Never leave a dashboard with no screen at all.
  if (!going || Object.keys(config.profiles).length < 2) return config;

  const remaining = Object.entries(config.profiles).filter(([other]) => other !== name);

  /*
   * The last screen standing keeps the window it has.
   *
   * A window is [from, to), so one that starts where it ends matches nothing
   * at all rather than everything - there is no way to write "all day" in this
   * notation. It does not matter: the server shows the first profile when no
   * window matches, and with one profile that is always this one. Widening it
   * to something that looks like the whole day would be a lie in the file.
   */
  if (remaining.length === 1) return { ...config, profiles: Object.fromEntries(remaining) };

  const profiles: Record<string, Profile> = {};
  for (const [other, profile] of remaining) {
    profiles[other] =
      profile.schedule.to === going.schedule.from
        ? { ...profile, schedule: { ...profile.schedule, to: going.schedule.to } }
        : profile;
  }
  return { ...config, profiles };
}

/**
 * Move where a screen starts, moving the end of whatever ran before it to
 * match so the day stays covered with no gap and no overlap.
 */
export function setProfileStart(config: DashboardConfig, name: string, from: string): DashboardConfig {
  const current = config.profiles[name];
  if (!current || current.schedule.from === from) return config;
  // Two screens starting at the same moment is an overlap by definition.
  if (Object.entries(config.profiles).some(([other, p]) => other !== name && p.schedule.from === from)) return config;

  const profiles: Record<string, Profile> = {};
  for (const [other, profile] of Object.entries(config.profiles)) {
    if (other === name) {
      profiles[other] = { ...profile, schedule: { ...profile.schedule, from } };
    } else if (profile.schedule.to === current.schedule.from) {
      profiles[other] = { ...profile, schedule: { ...profile.schedule, to: from } };
    } else {
      profiles[other] = profile;
    }
  }
  return { ...config, profiles };
}
