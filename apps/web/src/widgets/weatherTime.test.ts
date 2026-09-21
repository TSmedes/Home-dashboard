import { describe, expect, it } from "vitest";
import { hourLabel, localHourKey, shortClock, upcoming } from "./weatherTime.js";

const TZ = "America/Los_Angeles";

// Open-Meteo returns local wall-clock strings for the requested timezone,
// with no offset suffix. Comparing them against a UTC key is the bug this
// module exists to prevent.
const hours = Array.from({ length: 24 }, (_, i) => ({
  time: `2026-09-21T${String(i).padStart(2, "0")}:00`,
  temperature: 50 + i,
  precipitationProbability: i,
  code: 0,
}));

describe("localHourKey", () => {
  it("returns the local hour in the configured zone, not UTC", () => {
    // 19:31Z is 12:31 in Los Angeles on this date.
    expect(localHourKey(new Date("2026-09-21T19:31:00Z"), TZ)).toBe("2026-09-21T12");
  });

  it("rolls the date back when local time is still the previous day", () => {
    expect(localHourKey(new Date("2026-09-22T05:00:00Z"), TZ)).toBe("2026-09-21T22");
  });

  it("follows the zone, not the machine", () => {
    expect(localHourKey(new Date("2026-09-21T19:31:00Z"), "UTC")).toBe("2026-09-21T19");
  });
});

describe("upcoming", () => {
  it("starts at the current local hour", () => {
    const result = upcoming(hours, 8, new Date("2026-09-21T19:31:00Z"), TZ);
    expect(result[0]!.time).toBe("2026-09-21T12:00");
    expect(result).toHaveLength(8);
  });

  it("does not start at the UTC hour, which was the original defect", () => {
    const result = upcoming(hours, 8, new Date("2026-09-21T19:31:00Z"), TZ);
    expect(result[0]!.time).not.toBe("2026-09-21T19:00");
  });

  it("returns fewer entries near the end of the available data", () => {
    const result = upcoming(hours, 8, new Date("2026-09-22T05:00:00Z"), TZ); // 22:00 local
    expect(result).toHaveLength(2);
  });

  it("falls back to the start of the data when nothing matches", () => {
    const result = upcoming(hours, 3, new Date("2020-01-01T00:00:00Z"), TZ);
    expect(result[0]!.time).toBe("2026-09-21T00:00");
  });

  it("returns nothing when given nothing", () => {
    expect(upcoming([], 8, new Date(), TZ)).toEqual([]);
  });
});

describe("hourLabel", () => {
  it.each([
    ["2026-09-21T00:00", "12a"],
    ["2026-09-21T09:00", "9a"],
    ["2026-09-21T12:00", "12p"],
    ["2026-09-21T19:00", "7p"],
  ])("renders %s as %s in 12-hour mode", (iso, expected) => {
    expect(hourLabel(iso, "12h")).toBe(expected);
  });

  it("zero-pads in 24-hour mode", () => {
    expect(hourLabel("2026-09-21T09:00", "24h")).toBe("09");
    expect(hourLabel("2026-09-21T19:00", "24h")).toBe("19");
  });
});

describe("shortClock", () => {
  // Sunrise and sunset sat side by side as "6:52 - 7:06", which reads as two
  // morning times. The meridiem is not optional here.
  it("keeps morning and evening distinguishable in 12-hour mode", () => {
    expect(shortClock("2026-09-21T06:52", "12h")).toBe("6:52a");
    expect(shortClock("2026-09-21T19:06", "12h")).toBe("7:06p");
  });

  it("renders midnight and noon correctly", () => {
    expect(shortClock("2026-09-21T00:15", "12h")).toBe("12:15a");
    expect(shortClock("2026-09-21T12:15", "12h")).toBe("12:15p");
  });

  it("omits the meridiem in 24-hour mode", () => {
    expect(shortClock("2026-09-21T19:06", "24h")).toBe("19:06");
    expect(shortClock("2026-09-21T06:52", "24h")).toBe("06:52");
  });
});
