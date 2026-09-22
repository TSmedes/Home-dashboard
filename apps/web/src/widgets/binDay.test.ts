import { describe, expect, it } from "vitest";
import type { BinConfig } from "@home-dash/shared";
import { nextCollection, upcomingPickups } from "./binDay.js";

const tz = "America/Los_Angeles";

const bin = (overrides: Partial<BinConfig>): BinConfig => ({
  name: "Trash",
  day: "tue",
  every: 1,
  moved: [],
  skip: [],
  ...overrides,
});

// 2026-09-21 is a Monday.
describe("nextCollection", () => {
  it("finds the next weekly pickup, counting today", () => {
    expect(nextCollection(bin({}), "2026-09-21")).toEqual({ date: "2026-09-22", moved: false });
    expect(nextCollection(bin({}), "2026-09-22")).toEqual({ date: "2026-09-22", moved: false });
    expect(nextCollection(bin({}), "2026-09-23")).toEqual({ date: "2026-09-29", moved: false });
  });

  it("picks the right week for a fortnightly bin from its anchor", () => {
    const recycling = bin({ name: "Recycling", every: 2, anchor: "2026-09-29" });
    expect(nextCollection(recycling, "2026-09-21")!.date).toBe("2026-09-29");
    expect(nextCollection(recycling, "2026-09-30")!.date).toBe("2026-10-13");
  });

  it("works from an anchor in the past or written as another day of the pickup week", () => {
    const recycling = bin({ every: 2, anchor: "2025-01-02" }); // a Thursday in a pickup week
    // 2024-12-31 is that week's Tuesday; 90 weeks on is 2026-09-22.
    expect(nextCollection(recycling, "2026-09-21")!.date).toBe("2026-09-22");
  });

  it("follows a holiday shift and skips a cancelled pickup", () => {
    const shifted = bin({ moved: [{ from: "2026-09-22", to: "2026-09-23" }] });
    expect(nextCollection(shifted, "2026-09-21")).toEqual({ date: "2026-09-23", moved: true });

    const skipped = bin({ skip: ["2026-09-22"] });
    expect(nextCollection(skipped, "2026-09-21")!.date).toBe("2026-09-29");
  });
});

describe("upcomingPickups", () => {
  const bins = [bin({ name: "Trash" }), bin({ name: "Yard waste", day: "fri" })];

  it("lists every bin soonest first", () => {
    const pickups = upcomingPickups(bins, new Date("2026-09-21T17:00:00Z"), tz); // Monday 10am
    expect(pickups.map((p) => [p.name, p.daysAway])).toEqual([
      ["Trash", 1],
      ["Yard waste", 4],
    ]);
    expect(pickups[0]!.urgency).toBeNull();
  });

  it("says to put it out the evening before", () => {
    const pickups = upcomingPickups(bins, new Date("2026-09-22T01:00:00Z"), tz); // Monday 6pm
    expect(pickups[0]!.urgency).toBe("out-tonight");
  });

  it("flags collection day itself", () => {
    const pickups = upcomingPickups(bins, new Date("2026-09-22T14:00:00Z"), tz); // Tuesday 7am
    expect(pickups[0]).toMatchObject({ name: "Trash", daysAway: 0, urgency: "today" });
  });
});
