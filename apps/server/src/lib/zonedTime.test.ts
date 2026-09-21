import { describe, expect, it } from "vitest";
import { addDays, dateKeyInZone, wallTimeToInstant, zonedMidnight } from "./zonedTime.js";

const LA = "America/Los_Angeles";

describe("dateKeyInZone", () => {
  it("returns the local date, which differs from the UTC date in the evening", () => {
    // 04:00Z on the 22nd is still 21:00 on the 21st in Los Angeles.
    expect(dateKeyInZone(new Date("2026-09-22T04:00:00Z"), LA)).toBe("2026-09-21");
    expect(dateKeyInZone(new Date("2026-09-22T04:00:00Z"), "UTC")).toBe("2026-09-22");
  });
});

describe("addDays", () => {
  it.each([
    ["2026-09-21", 1, "2026-09-22"],
    ["2026-09-30", 1, "2026-10-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-03-01", -1, "2026-02-28"],
  ])("%s + %i = %s", (key, n, expected) => {
    expect(addDays(key, n)).toBe(expected);
  });
});

describe("wallTimeToInstant", () => {
  it("interprets a wall-clock time in the given zone (PDT, UTC-7)", () => {
    expect(wallTimeToInstant(2026, 9, 21, 9, 30, 0, LA).toISOString()).toBe("2026-09-21T16:30:00.000Z");
  });

  it("interprets a wall-clock time in the given zone (PST, UTC-8)", () => {
    expect(wallTimeToInstant(2026, 1, 15, 9, 30, 0, LA).toISOString()).toBe("2026-01-15T17:30:00.000Z");
  });

  it("is independent of the host's own timezone", () => {
    expect(wallTimeToInstant(2026, 9, 21, 0, 0, 0, "UTC").toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  // 2026-03-08 02:30 does not exist in Los Angeles; clocks jump 02:00 -> 03:00.
  it("resolves a time inside the spring-forward gap to a real instant", () => {
    const instant = wallTimeToInstant(2026, 3, 8, 2, 30, 0, LA);
    expect(["2026-03-08T09:30:00.000Z", "2026-03-08T10:30:00.000Z"]).toContain(instant.toISOString());
  });
});

describe("zonedMidnight", () => {
  it("returns local midnight as an instant", () => {
    expect(zonedMidnight("2026-09-21", LA).toISOString()).toBe("2026-09-21T07:00:00.000Z");
    expect(zonedMidnight("2026-01-15", LA).toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("gives the day of a DST change its real length", () => {
    const hours = (a: string, b: string) =>
      (zonedMidnight(b, LA).getTime() - zonedMidnight(a, LA).getTime()) / 3_600_000;
    expect(hours("2026-03-08", "2026-03-09")).toBe(23); // spring forward
    expect(hours("2026-11-01", "2026-11-02")).toBe(25); // fall back
    expect(hours("2026-09-21", "2026-09-22")).toBe(24);
  });
});
