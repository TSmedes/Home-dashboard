import { describe, expect, it } from "vitest";
import { dayLabel, zonedMidnight } from "./zoned.js";

describe("dayLabel", () => {
  // 2026-09-21 is a Monday.
  it("says today, tomorrow, then the weekday for the week ahead", () => {
    expect(dayLabel("2026-09-21", "2026-09-21")).toBe("Today");
    expect(dayLabel("2026-09-22", "2026-09-21")).toBe("Tomorrow");
    expect(dayLabel("2026-09-25", "2026-09-21")).toBe("Friday");
    expect(dayLabel("2026-09-27", "2026-09-21")).toBe("Sunday");
  });

  it("gives a short date from a week out", () => {
    expect(dayLabel("2026-09-28", "2026-09-21")).toBe("Sep 28");
    expect(dayLabel("2026-12-20", "2026-09-21")).toBe("Dec 20");
  });
});

describe("zonedMidnight", () => {
  it("is the instant a date begins in the zone", () => {
    expect(zonedMidnight("2026-09-22", "America/Los_Angeles")).toBe(Date.parse("2026-09-22T07:00:00Z"));
    expect(zonedMidnight("2026-01-15", "America/Los_Angeles")).toBe(Date.parse("2026-01-15T08:00:00Z"));
    expect(zonedMidnight("2026-09-22", "UTC")).toBe(Date.parse("2026-09-22T00:00:00Z"));
  });

  it("handles a zone ahead of UTC", () => {
    expect(zonedMidnight("2026-09-22", "Pacific/Auckland")).toBe(Date.parse("2026-09-21T12:00:00Z"));
  });
});
