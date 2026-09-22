import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@home-dash/shared";
import { buildAgenda, buildLater, eventSpan } from "./agenda.js";

const LA = "America/Los_Angeles";
// Monday 21 September 2026, noon in Los Angeles.
const NOON_MON = new Date("2026-09-21T19:00:00Z");

let n = 0;
const timed = (title: string, start: string, end: string, calendarId = "home"): CalendarEvent => ({
  id: `e${n++}`,
  calendarId,
  title,
  start,
  end,
  allDay: false,
});
const allDay = (title: string, start: string, end: string): CalendarEvent => ({
  id: `e${n++}`,
  calendarId: "home",
  title,
  start,
  end,
  allDay: true,
});

const titles = (days: ReturnType<typeof buildAgenda>) =>
  days.map((d) => [d.label, d.items.map((i) => i.event.title)]);

describe("buildAgenda", () => {
  it("labels days Today, Tomorrow, then weekday and date", () => {
    const days = buildAgenda(
      [
        timed("A", "2026-09-21T22:00:00Z", "2026-09-21T23:00:00Z"),
        timed("B", "2026-09-22T16:00:00Z", "2026-09-22T17:00:00Z"),
        timed("C", "2026-09-23T16:00:00Z", "2026-09-23T17:00:00Z"),
      ],
      NOON_MON,
      LA,
      3,
      "12h",
    );
    expect(days.map((d) => d.label)).toEqual(["Today", "Tomorrow", "Wednesday 23"]);
  });

  // 04:00Z on the 22nd is 21:00 on Monday the 21st in Los Angeles.
  it("places an event on its local date, not its UTC date", () => {
    const days = buildAgenda([timed("Late", "2026-09-22T04:00:00Z", "2026-09-22T05:00:00Z")], NOON_MON, LA, 3, "12h");
    expect(titles(days)).toEqual([["Today", ["Late"]]]);
  });

  it("hides events that have already ended today", () => {
    const days = buildAgenda(
      [
        timed("Breakfast", "2026-09-21T15:00:00Z", "2026-09-21T16:00:00Z"), // 08:00-09:00, over
        timed("Afternoon", "2026-09-21T22:00:00Z", "2026-09-21T23:00:00Z"),
      ],
      NOON_MON,
      LA,
      1,
      "12h",
    );
    expect(titles(days)).toEqual([["Today", ["Afternoon"]]]);
  });

  it("marks an event in progress as happening now", () => {
    const days = buildAgenda([timed("Lunch", "2026-09-21T18:30:00Z", "2026-09-21T19:30:00Z")], NOON_MON, LA, 1, "12h");
    expect(days[0]!.items[0]).toMatchObject({ now: true, when: { kind: "at", time: "11:30", meridiem: "am" } });
  });

  it("shows an overnight event that began yesterday under today, with its end time", () => {
    const days = buildAgenda(
      [timed("Shift", "2026-09-20T23:00:00Z", "2026-09-21T20:00:00Z")], // Sun 16:00 - Mon 13:00
      NOON_MON,
      LA,
      1,
      "12h",
    );
    expect(days[0]!.items[0]).toMatchObject({ now: true, when: { kind: "until", time: "1:00", meridiem: "pm" } });
  });

  it("repeats a multi-day all-day event on each day it covers, honouring its exclusive end", () => {
    const days = buildAgenda([allDay("Camping", "2026-09-22", "2026-09-24")], NOON_MON, LA, 4, "12h");
    expect(titles(days)).toEqual([
      ["Tomorrow", ["Camping"]],
      ["Wednesday 23", ["Camping"]],
    ]);
  });

  it("puts all-day events ahead of timed ones, then orders by time", () => {
    const days = buildAgenda(
      [
        timed("Late", "2026-09-22T23:00:00Z", "2026-09-22T23:30:00Z"),
        timed("Early", "2026-09-22T15:00:00Z", "2026-09-22T15:30:00Z"),
        allDay("Bin day", "2026-09-22", "2026-09-23"),
      ],
      NOON_MON,
      LA,
      2,
      "12h",
    );
    expect(titles(days)).toEqual([["Tomorrow", ["Bin day", "Early", "Late"]]]);
    expect(days[0]!.items[0]!.when).toEqual({ kind: "allDay" });
  });

  it("leaves out days with nothing on them", () => {
    const days = buildAgenda([timed("B", "2026-09-23T16:00:00Z", "2026-09-23T17:00:00Z")], NOON_MON, LA, 3, "12h");
    expect(days.map((d) => d.label)).toEqual(["Wednesday 23"]);
  });

  it("stops at the requested number of days", () => {
    const days = buildAgenda(
      [
        timed("Tue", "2026-09-22T16:00:00Z", "2026-09-22T17:00:00Z"),
        timed("Wed", "2026-09-23T16:00:00Z", "2026-09-23T17:00:00Z"),
      ],
      NOON_MON,
      LA,
      2,
      "12h",
    );
    expect(titles(days)).toEqual([["Tomorrow", ["Tue"]]]);
  });

  it("formats times on a 24-hour clock when configured", () => {
    const days = buildAgenda([timed("Tea", "2026-09-21T23:30:00Z", "2026-09-22T00:00:00Z")], NOON_MON, LA, 1, "24h");
    expect(days[0]!.items[0]!.when).toEqual({ kind: "at", time: "16:30", meridiem: "" });
  });

  it("keys items uniquely even when two calendars reuse an event id", () => {
    const a = { ...timed("A", "2026-09-22T16:00:00Z", "2026-09-22T17:00:00Z", "cal-1"), id: "same" };
    const b = { ...timed("B", "2026-09-22T18:00:00Z", "2026-09-22T19:00:00Z", "cal-2"), id: "same" };
    const keys = buildAgenda([a, b], NOON_MON, LA, 2, "12h").flatMap((d) => d.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(2);
  });

  // The night profile shows two days so it reads correctly on either side of
  // midnight: late on Monday, "Today" is the rest of Monday; after midnight,
  // "Today" has become Tuesday without any reconfiguration.
  it("rolls Today over at local midnight", () => {
    const events = [
      timed("Mon late", "2026-09-22T05:30:00Z", "2026-09-22T06:30:00Z"), // Mon 22:30
      timed("Tue morning", "2026-09-22T16:00:00Z", "2026-09-22T17:00:00Z"), // Tue 09:00
    ];
    const beforeMidnight = buildAgenda(events, new Date("2026-09-22T05:00:00Z"), LA, 2, "12h"); // Mon 22:00
    const afterMidnight = buildAgenda(events, new Date("2026-09-22T08:00:00Z"), LA, 2, "12h"); // Tue 01:00

    expect(titles(beforeMidnight)).toEqual([
      ["Today", ["Mon late"]],
      ["Tomorrow", ["Tue morning"]],
    ]);
    expect(titles(afterMidnight)).toEqual([["Today", ["Tue morning"]]]);
  });
});

describe("eventSpan", () => {
  it("gives a timed event's start and end", () => {
    const event = timed("Dentist", "2026-09-21T16:00:00Z", "2026-09-21T17:30:00Z");
    expect(eventSpan(event, LA, "12h")).toBe("9:00am – 10:30am");
    expect(eventSpan(event, LA, "24h")).toBe("09:00 – 10:30");
  });

  it("names the end day when it finishes on another day", () => {
    const event = timed("Night shift", "2026-09-22T04:00:00Z", "2026-09-22T14:00:00Z");
    expect(eventSpan(event, LA, "12h")).toBe("9:00pm – Tue 7:00am");
  });

  it("says how long an all-day event runs", () => {
    expect(eventSpan(allDay("Holiday", "2026-09-21", "2026-09-22"), LA, "12h")).toBe("All day");
    expect(eventSpan(allDay("Trip", "2026-09-26", "2026-09-29"), LA, "12h")).toBe("All day · 3 days");
  });
});

describe("buildLater", () => {
  const later = (events: CalendarEvent[], days = 7, daysAhead = 62) =>
    buildLater(events, NOON_MON, LA, days, daysAhead, "12h");

  it("starts the day after the agenda's last, so nothing is listed twice", () => {
    // days: 7 covers Mon 21 to Sun 27; Later begins on Mon 28.
    const items = later([
      timed("Inside", "2026-09-27T16:00:00Z", "2026-09-27T17:00:00Z"),
      timed("Beyond", "2026-09-28T16:00:00Z", "2026-09-28T17:00:00Z"),
    ]);
    expect(items.map((i) => i.event.title)).toEqual(["Beyond"]);
  });

  it("dates each event shortly enough for a narrow tile", () => {
    const items = later([
      timed("Flight", "2026-10-02T16:00:00Z", "2026-10-02T18:00:00Z"),
      allDay("Birthday", "2026-09-28", "2026-09-29"),
    ]);
    expect(items.map((i) => [i.date, i.event.title])).toEqual([
      ["Sep 28", "Birthday"],
      ["Oct 2", "Flight"],
    ]);
  });

  it("stops at the edge of what the feed covers", () => {
    const items = later(
      [
        timed("Just inside", "2026-11-21T16:00:00Z", "2026-11-21T17:00:00Z"),
        timed("Past the end", "2026-11-23T16:00:00Z", "2026-11-23T17:00:00Z"),
      ],
      7,
      62,
    );
    expect(items.map((i) => i.event.title)).toEqual(["Just inside"]);
  });

  it("carries a time for a timed event and says All day for the others", () => {
    const items = later([
      timed("Standup", "2026-10-01T16:00:00Z", "2026-10-01T17:00:00Z"),
      allDay("Trip", "2026-10-03", "2026-10-06"),
    ]);
    expect(items[0]!.when).toEqual({ kind: "at", time: "9:00", meridiem: "am" });
    expect(items[1]!.when).toEqual({ kind: "allDay" });
  });

  it("lists a long event once, on the day it starts", () => {
    const items = later([allDay("Trip", "2026-10-03", "2026-10-08")]);
    expect(items).toHaveLength(1);
    expect(items[0]!.date).toBe("Oct 3");
  });

  it("follows the tile's own days option, not a fixed week", () => {
    const events = [timed("Thursday", "2026-09-24T16:00:00Z", "2026-09-24T17:00:00Z")];
    expect(later(events, 7).map((i) => i.event.title)).toEqual([]);
    expect(later(events, 2).map((i) => i.event.title)).toEqual(["Thursday"]);
  });

  it("orders by when it starts", () => {
    const items = later([
      timed("Third", "2026-10-09T16:00:00Z", "2026-10-09T17:00:00Z"),
      timed("First", "2026-09-29T16:00:00Z", "2026-09-29T17:00:00Z"),
      timed("Second", "2026-10-02T16:00:00Z", "2026-10-02T17:00:00Z"),
    ]);
    expect(items.map((i) => i.event.title)).toEqual(["First", "Second", "Third"]);
  });
});
