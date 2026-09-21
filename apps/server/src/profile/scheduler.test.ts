import { describe, expect, it } from "vitest";
import type { Profile } from "@home-dash/shared";
import { minutesInZone, nextBoundary, resolveActiveProfile } from "./scheduler.js";

const widget = [{ id: "clock", type: "clock", grid: { col: 1, row: 1, colSpan: 4, rowSpan: 2 }, options: {} }];

const profiles: Record<string, Profile> = {
  day: { schedule: { from: "06:30", to: "21:30" }, theme: "light", widgets: widget },
  night: { schedule: { from: "21:30", to: "06:30" }, theme: "dark", widgets: widget },
};

const TZ = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);

describe("minutesInZone", () => {
  it("converts a UTC instant to local minutes past midnight (PDT, UTC-7)", () => {
    expect(minutesInZone(at("2026-07-15T15:00:00Z"), TZ)).toBe(8 * 60);
  });

  it("honours the winter offset (PST, UTC-8) for the same wall-clock hour", () => {
    expect(minutesInZone(at("2026-01-15T16:00:00Z"), TZ)).toBe(8 * 60);
  });

  it("is timezone-specific, not server-local", () => {
    expect(minutesInZone(at("2026-07-15T15:00:00Z"), "UTC")).toBe(15 * 60);
  });
});

// "Until the next scheduled switch" - when a manual night-mode override ends.
describe("nextBoundary", () => {
  const next = (iso: string) => nextBoundary(profiles, at(iso), TZ).toISOString();

  it("finds this evening's switch to night from midday", () => {
    expect(next("2026-09-21T19:00:00Z")).toBe("2026-09-22T04:30:00.000Z"); // 21:30 PDT
  });

  it("finds tomorrow morning's switch late at night, across midnight", () => {
    expect(next("2026-09-22T06:00:00Z")).toBe("2026-09-22T13:30:00.000Z"); // 23:00 -> 06:30 PDT
  });

  it("looks strictly ahead when called at the exact moment of a switch", () => {
    expect(next("2026-09-22T04:30:00Z")).toBe("2026-09-22T13:30:00.000Z");
  });

  it("lands on the right instant across spring-forward", () => {
    // Saturday 23:00 PST; clocks jump overnight, so 06:30 is PDT (UTC-7).
    expect(next("2026-03-08T07:00:00Z")).toBe("2026-03-08T13:30:00.000Z");
  });

  it("lands on the right instant across fall-back", () => {
    // Saturday 23:00 PDT; clocks fall back overnight, so 06:30 is PST (UTC-8).
    expect(next("2026-11-01T06:00:00Z")).toBe("2026-11-01T14:30:00.000Z");
  });
});

describe("resolveActiveProfile", () => {
  it("selects the day profile mid-morning", () => {
    expect(resolveActiveProfile(profiles, at("2026-07-15T15:00:00Z"), TZ)).toBe("day");
  });

  it("selects the night profile late in the evening", () => {
    expect(resolveActiveProfile(profiles, at("2026-07-16T05:00:00Z"), TZ)).toBe("night");
  });

  it("selects the night profile after midnight, inside the wrapped window", () => {
    expect(resolveActiveProfile(profiles, at("2026-07-15T09:00:00Z"), TZ)).toBe("night");
  });

  it.each([
    ["2026-07-15T13:29:00Z", "night", "one minute before the day window opens"],
    ["2026-07-15T13:30:00Z", "day", "exactly when the day window opens"],
    ["2026-07-16T04:29:00Z", "day", "one minute before the day window closes"],
    ["2026-07-16T04:30:00Z", "night", "exactly when the day window closes"],
  ])("at %s resolves to %s (%s)", (instant, expected) => {
    expect(resolveActiveProfile(profiles, at(instant), TZ)).toBe(expected);
  });

  it("keeps working across a DST change", () => {
    // 08:00 local on both sides of the spring-forward boundary.
    expect(resolveActiveProfile(profiles, at("2026-03-01T16:00:00Z"), TZ)).toBe("day");
    expect(resolveActiveProfile(profiles, at("2026-04-01T15:00:00Z"), TZ)).toBe("day");
  });

  it("falls back to the first profile when no window matches, so the wall is never blank", () => {
    const gapped: Record<string, Profile> = {
      morning: { schedule: { from: "06:00", to: "09:00" }, theme: "light", widgets: widget },
      evening: { schedule: { from: "18:00", to: "22:00" }, theme: "dark", widgets: widget },
    };
    expect(resolveActiveProfile(gapped, at("2026-07-15T20:00:00Z"), TZ)).toBe("morning");
  });

  it("treats a single profile as always active", () => {
    const only: Record<string, Profile> = {
      always: { schedule: { from: "06:30", to: "21:30" }, theme: "light", widgets: widget },
    };
    expect(resolveActiveProfile(only, at("2026-07-15T09:00:00Z"), TZ)).toBe("always");
  });

  it("resolves overlapping windows deterministically by declaration order", () => {
    const overlapping: Record<string, Profile> = {
      first: { schedule: { from: "06:00", to: "22:00" }, theme: "light", widgets: widget },
      second: { schedule: { from: "07:00", to: "21:00" }, theme: "dark", widgets: widget },
    };
    expect(resolveActiveProfile(overlapping, at("2026-07-15T15:00:00Z"), TZ)).toBe("first");
  });
});
