import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@home-dash/shared";
import { fromCalendar, mergeCountdowns } from "./index.js";

const tz = "America/Los_Angeles";

const event = (id: string, title: string, start: string, allDay = true): CalendarEvent => ({
  id,
  calendarId: "family",
  title,
  start,
  end: start,
  allDay,
});

describe("fromCalendar", () => {
  it("keeps only tagged events and drops the tag from the name", () => {
    const result = fromCalendar(
      [event("a", "Dentist", "2026-10-01"), event("b", "Hawaii trip #countdown", "2026-12-20")],
      "#countdown",
      tz,
    );
    expect(result).toEqual([{ id: "calendar:b", name: "Hawaii trip", date: "2026-12-20", source: "calendar" }]);
  });

  it("matches the tag anywhere, in any case", () => {
    const result = fromCalendar([event("a", "#Countdown Sam's birthday", "2026-11-02")], "#countdown", tz);
    expect(result[0]!.name).toBe("Sam's birthday");
  });

  it("counts down to only the next occurrence of a repeating event", () => {
    const result = fromCalendar(
      [event("a1", "Anniversary #countdown", "2026-10-10"), event("a2", "Anniversary #countdown", "2027-10-10")],
      "#countdown",
      tz,
    );
    expect(result.map((c) => c.date)).toEqual(["2026-10-10"]);
  });

  it("dates a timed event by its local day, not its UTC one", () => {
    // 8pm on the 3rd in Seattle is already the 4th in UTC.
    const result = fromCalendar([event("a", "Flight #countdown", "2026-11-04T04:00:00Z", false)], "#countdown", tz);
    expect(result[0]!.date).toBe("2026-11-03");
  });
});

describe("mergeCountdowns", () => {
  const config = {
    calendarTag: "#countdown",
    daysAhead: 365,
    items: [
      { name: "Halloween", date: "2026-10-31", emoji: "🎃" },
      { name: "Last summer", date: "2026-08-01" },
    ],
  };

  it("merges both sources soonest first and drops anything past", () => {
    const calendar = [{ id: "calendar:x", name: "Trip", date: "2026-10-05", source: "calendar" as const }];
    const result = mergeCountdowns(config, calendar, "2026-09-21");
    expect(result.map((c) => c.name)).toEqual(["Trip", "Halloween"]);
    expect(result[1]).toMatchObject({ emoji: "🎃", source: "config" });
  });

  it("keeps a countdown on its day", () => {
    expect(mergeCountdowns(config, [], "2026-10-31").map((c) => c.name)).toEqual(["Halloween"]);
  });
});
