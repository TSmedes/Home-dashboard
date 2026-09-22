import { describe, expect, it } from "vitest";
import { DashboardConfigSchema, type DashboardConfig, type Profile } from "@home-dash/shared";
import {
  addProfile,
  canAddProfile,
  removeProfile,
  setProfileStart,
  toClock,
  toMinutes,
  uniqueProfileName,
  windowLength,
} from "./profiles.js";

const profile = (from: string, to: string, theme: "light" | "dark" = "light") => ({
  schedule: { from, to },
  theme,
  widgets: [{ id: "clock", type: "clock", grid: { col: 1, row: 1, colSpan: 12, rowSpan: 6 } }],
});

const config = (profiles: Record<string, unknown>): DashboardConfig =>
  DashboardConfigSchema.parse({
    location: { name: "Snoqualmie", lat: 47.5287, lon: -121.8254, timezone: "America/Los_Angeles" },
    units: { temperature: "fahrenheit", wind: "mph", clock: "12h" },
    profiles,
  });

const day = config({ day: profile("06:30", "21:30"), night: profile("21:30", "06:30", "dark") });

/**
 * The invariant, as a property: at every minute of the day, exactly one screen
 * is the one showing. This is the same [from, to) rule the server applies,
 * windows that wrap past midnight and all.
 */
function coverage(profiles: Record<string, Profile>): { minute: number; showing: string[] }[] {
  const within = (minutes: number, from: string, to: string) => {
    const start = toMinutes(from);
    const end = toMinutes(to);
    return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  };

  const bad: { minute: number; showing: string[] }[] = [];
  for (let minute = 0; minute < 1440; minute += 1) {
    const showing = Object.entries(profiles)
      .filter(([, p]) => within(minute, p.schedule.from, p.schedule.to))
      .map(([name]) => name);
    if (showing.length !== 1) bad.push({ minute, showing });
  }
  return bad;
}

/**
 * Every result must satisfy the schema, and - with more than one screen -
 * cover the day exactly once.
 *
 * The exception is deliberate. A window is [from, to), so there is no way to
 * write "all day": one that starts where it ends matches nothing. With a
 * single profile that does not matter, because the server shows the first one
 * when no window matches, and that is always this one.
 */
const covers = (next: DashboardConfig) => {
  expect(() => DashboardConfigSchema.parse(next)).not.toThrow();
  if (Object.keys(next.profiles).length > 1) expect(coverage(next.profiles)).toEqual([]);
  return next;
};

describe("clock arithmetic", () => {
  it("reads and writes a wall-clock time", () => {
    expect(toMinutes("06:30")).toBe(390);
    expect(toClock(390)).toBe("06:30");
    expect(toClock(0)).toBe("00:00");
  });

  it("wraps past midnight rather than going negative", () => {
    expect(toClock(1440 + 90)).toBe("01:30");
    expect(toClock(-30)).toBe("23:30");
  });

  it("measures a window that crosses midnight", () => {
    expect(windowLength("06:30", "21:30")).toBe(15 * 60);
    expect(windowLength("21:30", "06:30")).toBe(9 * 60);
  });

  it("treats a window that starts where it ends as the whole day", () => {
    expect(windowLength("06:00", "06:00")).toBe(1440);
  });
});

describe("the shipped schedule", () => {
  it("covers the day exactly once to begin with", () => {
    expect(coverage(day.profiles)).toEqual([]);
  });
});

describe("addProfile", () => {
  it("halves the longest window and leaves the day covered", () => {
    const next = covers(addProfile(day, "evening"));
    expect(Object.keys(next.profiles)).toEqual(["day", "night", "evening"]);
    // The day screen was the long one: 06:30-21:30 becomes 06:30-14:00.
    expect(next.profiles.day!.schedule).toEqual({ from: "06:30", to: "14:00" });
    expect(next.profiles.evening!.schedule).toEqual({ from: "14:00", to: "21:30" });
  });

  it("gives the new screen a clock, so it is never a blank wall", () => {
    const next = addProfile(day, "evening");
    expect(next.profiles.evening!.widgets.map((w) => w.type)).toEqual(["clock"]);
  });

  it("splits a single whole-day profile", () => {
    const one = config({ all: profile("00:00", "00:00") });
    const next = covers(addProfile(one, "night"));
    expect(Object.keys(next.profiles)).toHaveLength(2);
  });

  it("numbers a name already taken", () => {
    const next = addProfile(addProfile(day, "evening"), "evening");
    expect(Object.keys(next.profiles)).toContain("evening-2");
    covers(next);
  });

  it("refuses when there is no window left worth splitting", () => {
    const tight = config({ a: profile("00:00", "00:10"), b: profile("00:10", "00:00") });
    expect(canAddProfile(tight)).toBe(true); // b is still most of the day
    const slivers = config({ a: profile("00:00", "00:10"), b: profile("00:10", "00:20"), c: profile("00:20", "00:00") });
    expect(addProfile(slivers, "d")).not.toBe(slivers);
    covers(addProfile(slivers, "d"));
  });
});

describe("removeProfile", () => {
  it("gives the time to whatever ran before it", () => {
    const three = covers(addProfile(day, "evening"));
    // day 06:30-14:00, evening 14:00-21:30, night 21:30-06:30.
    const next = covers(removeProfile(three, "evening"));
    expect(next.profiles.day!.schedule).toEqual({ from: "06:30", to: "21:30" });
  });

  it("leaves the last screen the window it had, rather than lying about it", () => {
    const next = removeProfile(day, "night");
    expect(Object.keys(next.profiles)).toEqual(["day"]);
    // There is no way to write "all day" in [from, to); the server's fallback
    // is what covers the rest, so the file stays honest.
    expect(next.profiles.day!.schedule).toEqual({ from: "06:30", to: "21:30" });
  });

  it("keeps the day covered with three screens", () => {
    const three = covers(addProfile(day, "evening"));
    covers(removeProfile(three, "evening"));
    covers(removeProfile(three, "day"));
    covers(removeProfile(three, "night"));
  });

  it("refuses to remove the last screen", () => {
    const one = config({ all: profile("00:00", "00:00") });
    expect(removeProfile(one, "all")).toBe(one);
  });

  it("does nothing for a screen that is not there", () => {
    expect(removeProfile(day, "evening")).toBe(day);
  });

  it("leaves a hand-edited gap alone rather than guessing", () => {
    // Inventing a window to close someone else's gap is how you get an
    // overlap instead; the server already falls back when nothing matches.
    const gapped = config({ a: profile("06:00", "12:00"), b: profile("13:00", "06:00"), c: profile("12:00", "12:30") });
    const next = removeProfile(gapped, "c");
    expect(next.profiles.a!.schedule).toEqual({ from: "06:00", to: "12:30" });
    expect(next.profiles.b!.schedule).toEqual({ from: "13:00", to: "06:00" });
  });
});

describe("setProfileStart", () => {
  it("moves the end of the screen before it to match", () => {
    const next = covers(setProfileStart(day, "night", "22:00"));
    expect(next.profiles.day!.schedule.to).toBe("22:00");
    expect(next.profiles.night!.schedule.from).toBe("22:00");
  });

  it("refuses to put two screens at the same moment", () => {
    expect(setProfileStart(day, "night", "06:30")).toBe(day);
  });

  it("does nothing when the time has not changed", () => {
    expect(setProfileStart(day, "night", "21:30")).toBe(day);
  });
});

describe("uniqueProfileName", () => {
  it("tidies a name into something readable in the file", () => {
    expect(uniqueProfileName({}, "Sunday Morning")).toBe("sunday-morning");
  });

  it("numbers one that is taken", () => {
    expect(uniqueProfileName(day.profiles, "day")).toBe("day-2");
  });
});
