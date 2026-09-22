import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@home-dash/shared";
import { addMonths, daysInMonth, eventsOn, monthGrid, monthLabel, monthOf, reachableMonths } from "./month.js";

const TZ = "America/Los_Angeles";

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e",
  calendarId: "home",
  title: "Thing",
  start: "2026-09-22T17:00:00.000Z",
  end: "2026-09-22T18:00:00.000Z",
  allDay: false,
  ...over,
});

const grid = (month: string, events: CalendarEvent[] = [], today = "2026-09-22") =>
  monthGrid(month, events, today, TZ, "12h");

describe("month arithmetic", () => {
  it("steps months across a year boundary", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("knows how long a month is, including February in a leap year", () => {
    expect(daysInMonth("2026-09")).toBe(30);
    expect(daysInMonth("2026-01")).toBe(31);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
  });

  it("names a month the way a heading would", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(monthOf("2026-09-22")).toBe("2026-09");
  });
});

describe("monthGrid", () => {
  it("lands the 1st on its real weekday, Monday first", () => {
    // 1 September 2026 is a Tuesday, so one leading day from August.
    const weeks = grid("2026-09");
    expect(weeks[0]!.map((d) => d.dayOfMonth)).toEqual([31, 1, 2, 3, 4, 5, 6]);
    expect(weeks[0]![0]).toMatchObject({ dateKey: "2026-08-31", inMonth: false });
    expect(weeks[0]![1]).toMatchObject({ dateKey: "2026-09-01", inMonth: true });
  });

  it("needs no leading days when the month starts on a Monday", () => {
    // 1 June 2026 is a Monday.
    const weeks = grid("2026-06");
    expect(weeks[0]![0]).toMatchObject({ dateKey: "2026-06-01", inMonth: true });
  });

  it("always gives whole weeks, and covers every day of the month", () => {
    for (const month of ["2026-02", "2026-06", "2026-09", "2026-01", "2028-02"]) {
      const weeks = grid(month);
      for (const week of weeks) expect(week).toHaveLength(7);
      const inMonth = weeks.flat().filter((d) => d.inMonth);
      expect(inMonth).toHaveLength(daysInMonth(month));
      expect(inMonth[0]!.dayOfMonth).toBe(1);
      expect(inMonth.at(-1)!.dayOfMonth).toBe(daysInMonth(month));
    }
  });

  it("marks today, and marks earlier days as past since the feed has nothing for them", () => {
    const days = grid("2026-09").flat();
    const today = days.find((d) => d.dateKey === "2026-09-22")!;
    expect(today).toMatchObject({ isToday: true, past: false });
    expect(days.find((d) => d.dateKey === "2026-09-21")!.past).toBe(true);
    expect(days.find((d) => d.dateKey === "2026-09-23")!.past).toBe(false);
  });

  it("puts a timed event on its day, with its start time", () => {
    const days = grid("2026-09", [event({ title: "Dentist" })]).flat();
    // 17:00 UTC is 10:00 in Los Angeles.
    expect(days.find((d) => d.dateKey === "2026-09-22")!.items).toMatchObject([{ time: "10:00" }]);
    expect(days.find((d) => d.dateKey === "2026-09-23")!.items).toEqual([]);
  });

  it("spans an all-day event across its days, exclusive of the end date", () => {
    const trip = event({ title: "Trip", allDay: true, start: "2026-09-25", end: "2026-09-28" });
    const days = grid("2026-09", [trip]).flat();
    const on = (key: string) => days.find((d) => d.dateKey === key)!.items.length;
    expect([on("2026-09-24"), on("2026-09-25"), on("2026-09-27"), on("2026-09-28")]).toEqual([0, 1, 1, 0]);
  });

  it("gives a multi-day timed event a time only on the day it starts", () => {
    const long = event({ title: "Conf", start: "2026-09-24T16:00:00.000Z", end: "2026-09-26T01:00:00.000Z" });
    const days = grid("2026-09", [long]).flat();
    expect(days.find((d) => d.dateKey === "2026-09-24")!.items[0]!.time).toBe("9:00");
    expect(days.find((d) => d.dateKey === "2026-09-25")!.items[0]!.time).toBe("");
  });

  it("keeps an event ending at midnight on the day it ran in", () => {
    const late = event({ start: "2026-09-22T04:00:00.000Z", end: "2026-09-22T07:00:00.000Z" });
    const days = grid("2026-09", [late]).flat();
    // 07:00 UTC is midnight in Los Angeles, ending the 21st.
    expect(days.find((d) => d.dateKey === "2026-09-21")!.items).toHaveLength(1);
    expect(days.find((d) => d.dateKey === "2026-09-22")!.items).toHaveLength(0);
  });
});

describe("eventsOn", () => {
  it("lists all-day events before timed ones, then by start", () => {
    const events = [
      event({ id: "b", title: "Late", start: "2026-09-22T22:00:00.000Z", end: "2026-09-22T23:00:00.000Z" }),
      event({ id: "a", title: "Holiday", allDay: true, start: "2026-09-22", end: "2026-09-23" }),
      event({ id: "c", title: "Early", start: "2026-09-22T16:00:00.000Z", end: "2026-09-22T17:00:00.000Z" }),
    ];
    expect(eventsOn(events, "2026-09-22", TZ).map((e) => e.title)).toEqual(["Holiday", "Early", "Late"]);
  });
});

describe("reachableMonths", () => {
  it("offers this month and every later one the feed covers to its last day", () => {
    // 62 days from 22 September reaches 22 November, so October is complete
    // and November is not.
    expect(reachableMonths("2026-09-22", 62)).toEqual(["2026-09", "2026-10"]);
    // From the 1st the window ends 1 November: October is still complete.
    expect(reachableMonths("2026-09-01", 62)).toEqual(["2026-09", "2026-10"]);
  });

  it("offers only this month when the feed is too narrow to finish the next", () => {
    expect(reachableMonths("2026-09-22", 7)).toEqual(["2026-09"]);
  });

  it("crosses a year boundary", () => {
    expect(reachableMonths("2026-12-01", 62)).toEqual(["2026-12", "2027-01"]);
  });
});
