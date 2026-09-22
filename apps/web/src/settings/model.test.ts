import { describe, expect, it } from "vitest";
import type { Profile } from "@home-dash/shared";
import { ago, overrideSummary, profileLabel, scheduleChanges } from "./model.js";

const LA = "America/Los_Angeles";
const clockWidget = [{ id: "clock", type: "clock", enabled: true, page: 1, grid: { col: 1, row: 1, colSpan: 1, rowSpan: 1, share: false }, options: {} }];
const profiles: Record<string, Profile> = {
  day: { schedule: { from: "06:30", to: "21:30" }, theme: "light", returnToFirstPage: 120, widgets: clockWidget },
  night: { schedule: { from: "21:30", to: "06:30" }, theme: "dark", returnToFirstPage: 120, widgets: clockWidget },
};

describe("scheduleChanges", () => {
  // Moving when night starts must also move when day ends, or the schedule
  // would open a gap (nothing matches) or an overlap (first one wins).
  it("moves the previous profile's end along with this profile's start", () => {
    expect(scheduleChanges(profiles, "night", "22:00")).toEqual([
      { path: ["profiles", "night", "schedule", "from"], value: "22:00" },
      { path: ["profiles", "day", "schedule", "to"], value: "22:00" },
    ]);
  });

  it("works the same way across midnight", () => {
    expect(scheduleChanges(profiles, "day", "07:00")).toEqual([
      { path: ["profiles", "day", "schedule", "from"], value: "07:00" },
      { path: ["profiles", "night", "schedule", "to"], value: "07:00" },
    ]);
  });

  it("changes nothing when the time is unchanged", () => {
    expect(scheduleChanges(profiles, "day", "06:30")).toEqual([]);
  });

  it("refuses two profiles starting at the same moment", () => {
    expect(() => scheduleChanges(profiles, "day", "21:30")).toThrow(/same time/);
  });
});

describe("overrideSummary", () => {
  const noon = new Date("2026-09-21T19:00:00Z");

  it("says the schedule is in charge when there is no override", () => {
    expect(overrideSummary(null, "day", noon, LA, "12h")).toBe("Showing the day screen, on schedule.");
  });

  it("says until when an override lasts", () => {
    const override = { profile: "night", until: "2026-09-22T04:30:00.000Z" };
    expect(overrideSummary(override, "night", noon, LA, "12h")).toBe(
      "Showing the night screen until 9:30 pm, then back on schedule.",
    );
  });

  it("says tomorrow when the override runs past midnight", () => {
    const override = { profile: "day", until: "2026-09-22T13:30:00.000Z" };
    const late = new Date("2026-09-22T06:00:00Z"); // 23:00
    expect(overrideSummary(override, "day", late, LA, "12h")).toBe(
      "Showing the day screen until 6:30 am tomorrow, then back on schedule.",
    );
  });
});

describe("ago", () => {
  const now = new Date("2026-09-21T19:00:00Z");
  it.each([
    ["2026-09-21T18:59:40Z", "just now"],
    ["2026-09-21T18:58:00Z", "2 min ago"],
    ["2026-09-21T16:00:00Z", "3 h ago"],
    ["2026-09-19T19:00:00Z", "2 days ago"],
    ["2026-09-21T19:00:30Z", "just now"], // a server clock slightly ahead
  ])("%s is %s", (iso, expected) => {
    expect(ago(iso, now)).toBe(expected);
  });
});

describe("profileLabel", () => {
  it("capitalises a profile key for display", () => {
    expect(profileLabel("night")).toBe("Night");
  });
});
