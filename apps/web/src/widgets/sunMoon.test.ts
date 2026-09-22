import { describe, expect, it } from "vitest";
import { formatChange, formatDuration, moonNow, moonPath, phaseName, sunToday } from "./sunMoon.js";

const tz = "America/Los_Angeles";
const snoqualmie = { lat: 47.5287, lon: -121.8254 };
/** 10am on the equinox week, 2026-09-21. */
const now = new Date("2026-09-21T17:00:00Z");

describe("sunToday", () => {
  const sun = sunToday(now, snoqualmie.lat, snoqualmie.lon, tz);

  it("gives Snoqualmie's sunrise and sunset for the local day", () => {
    // Published times for the day: sunrise 6:54am, sunset 7:09pm PDT.
    expect(sun.sunrise!.toISOString()).toMatch(/^2026-09-21T13:5[3-5]/);
    expect(sun.sunset!.toISOString()).toMatch(/^2026-09-22T02:0[8-9]/);
    expect(formatDuration(sun.dayLength!)).toBe("12h 15m");
  });

  it("shows days shortening by about three minutes in late September", () => {
    expect(sun.change!).toBeLessThan(-150);
    expect(sun.change!).toBeGreaterThan(-240);
  });

  it("uses the dashboard's date, not UTC's, late in the evening", () => {
    // 11pm on the 21st in Seattle is already the 22nd in UTC.
    const late = sunToday(new Date("2026-09-22T06:00:00Z"), snoqualmie.lat, snoqualmie.lon, tz);
    expect(late.sunrise!.toISOString().slice(0, 10)).toBe("2026-09-21");
  });

  it("copes with a polar day that has no sunset", () => {
    const svalbard = sunToday(new Date("2026-06-21T12:00:00Z"), 78.22, 15.65, "Arctic/Longyearbyen");
    expect(svalbard.sunset).toBeNull();
    expect(svalbard.dayLength).toBeNull();
    expect(svalbard.change).toBeNull();
  });
});

describe("moon", () => {
  it("finds the September 2026 harvest moon as the next full moon", () => {
    const moon = moonNow(now);
    expect(moon.name).toBe("Waxing gibbous");
    expect(moon.next.kind).toBe("Full moon");
    expect(moon.next.at.toISOString().slice(0, 10)).toBe("2026-09-26");
  });

  it("names each phase", () => {
    expect(phaseName(0.01)).toBe("New moon");
    expect(phaseName(0.99)).toBe("New moon");
    expect(phaseName(0.12)).toBe("Waxing crescent");
    expect(phaseName(0.25)).toBe("First quarter");
    expect(phaseName(0.4)).toBe("Waxing gibbous");
    expect(phaseName(0.5)).toBe("Full moon");
    expect(phaseName(0.6)).toBe("Waning gibbous");
    expect(phaseName(0.75)).toBe("Last quarter");
    expect(phaseName(0.85)).toBe("Waning crescent");
  });

  it("draws a half disc at the quarters, lit on the right while waxing", () => {
    // Zero-width terminator: the lit part is exactly the outer half circle.
    expect(moonPath(0.25, 10, 10, 10)).toMatch(/^M 10 0 A 10 10 0 0 1 10 20 A 0 10 /);
    expect(moonPath(0.75, 10, 10, 10)).toMatch(/^M 10 0 A 10 10 0 0 0 10 20 A 0 10 /);
  });

  it("bows a crescent's terminator towards its lit edge", () => {
    // Waxing crescent: lit on the right, the terminator returns up the right side.
    expect(moonPath(0.1, 10, 10, 10)).toMatch(/A 10 10 0 0 1 10 20 A [\d.]+ 10 0 0 0 10 0/);
    // Waning crescent: lit on the left, the terminator returns up the left side.
    expect(moonPath(0.9, 10, 10, 10)).toMatch(/A 10 10 0 0 0 10 20 A [\d.]+ 10 0 0 1 10 0/);
  });
});

describe("formatting", () => {
  it("formats daylight and its daily change", () => {
    expect(formatDuration(12 * 3600 + 4 * 60)).toBe("12h 04m");
    expect(formatChange(161)).toBe("+2m 41s");
    expect(formatChange(-185)).toBe("−3m 05s");
    expect(formatChange(12)).toBe("+12s");
  });
});
