import { describe, expect, it } from "vitest";
import type { RiverGauge } from "@home-dash/shared";
import { dayTicks, formatLevel, nextThreshold, shortName, sparkline, trendOf } from "./river.js";

const base: RiverGauge = {
  gauge: "SQUW1",
  name: "Snoqualmie River at Snoqualmie Falls",
  measure: "flow",
  unit: "cfs",
  current: { time: "2026-09-22T00:00:00Z", value: 365 },
  change6h: 0,
  category: "none",
  thresholds: { action: 15000, minor: 20000, moderate: 31000, major: 41000 },
  forecastPeak: null,
  observed: [
    { time: "2026-09-21T00:00:00Z", value: 350 },
    { time: "2026-09-22T00:00:00Z", value: 365 },
  ],
  forecast: [{ time: "2026-09-23T00:00:00Z", value: 400 }],
};

describe("river", () => {
  it("shortens NOAA's names to fit a row", () => {
    expect(shortName("North Fork Snoqualmie River near Snoqualmie Falls")).toBe("North Fork");
    expect(shortName("Middle Fork Snoqualmie River near Tanner")).toBe("Middle Fork");
    expect(shortName("South Fork Snoqualmie River near South Fork Snoqualmie R near Garcia")).toBe("South Fork");
    expect(shortName("Snoqualmie River at Snoqualmie Falls")).toBe("Snoqualmie Falls");
    expect(shortName("Snoqualmie River near Carnation")).toBe("Carnation");
    expect(shortName("Somewhere")).toBe("Somewhere");
  });

  it("formats flow and stage", () => {
    expect(formatLevel(12400, "cfs")).toBe("12,400 cfs");
    expect(formatLevel(8.44, "ft")).toBe("8.4 ft");
  });

  it("names the next threshold above the river", () => {
    expect(nextThreshold(base)).toEqual({ category: "action", value: 15000 });
    expect(nextThreshold({ ...base, current: { ...base.current!, value: 22000 } })).toEqual({ category: "moderate", value: 31000 });
    expect(nextThreshold({ ...base, current: { ...base.current!, value: 50000 } })).toBeNull();
  });

  it("ignores wobble when calling the trend", () => {
    expect(trendOf({ ...base, change6h: 5 })).toBe("steady");
    expect(trendOf({ ...base, change6h: 400 })).toBe("rising");
    expect(trendOf({ ...base, change6h: -400 })).toBe("falling");
    expect(trendOf({ ...base, change6h: null })).toBeNull();
  });

  it("leaves the flood line off a summer trickle and draws it in a flood", () => {
    expect(sparkline(base, 100, 40)!.threshold).toBeNull();
    const high = {
      ...base,
      observed: [
        { time: "2026-09-21T00:00:00Z", value: 9000 },
        { time: "2026-09-22T00:00:00Z", value: 12000 },
      ],
    };
    const line = sparkline(high, 100, 40)!;
    expect(line.threshold!.label).toBe("15,000 cfs");
    expect(line.threshold!.y).toBeGreaterThan(0);
    expect(line.forecast.startsWith("M 50.0")).toBe(true); // joined to the last observation
  });
});

describe("dayTicks", () => {
  it("marks each local midnight inside the span, named for the day it starts", () => {
    // 21 Sep 12:00 to 23 Sep 18:00 in Los Angeles (UTC-7).
    const t0 = Date.parse("2026-09-21T19:00:00Z");
    const t1 = Date.parse("2026-09-24T01:00:00Z");
    expect(dayTicks(t0, t1, "America/Los_Angeles")).toEqual([
      { at: Date.parse("2026-09-22T07:00:00Z"), label: "Tue" },
      { at: Date.parse("2026-09-23T07:00:00Z"), label: "Wed" },
    ]);
  });

  it("is empty for a span inside one day", () => {
    expect(dayTicks(Date.parse("2026-09-21T15:00:00Z"), Date.parse("2026-09-21T20:00:00Z"), "UTC")).toEqual([]);
  });
});

describe("sparkline span", () => {
  it("reports the time axis it drew, so labels can line up with it", () => {
    const line = sparkline(base, 100, 20)!;
    expect(line.t0).toBe(Date.parse("2026-09-21T00:00:00Z"));
    expect(line.t1).toBe(Date.parse("2026-09-23T00:00:00Z"));
  });
});
