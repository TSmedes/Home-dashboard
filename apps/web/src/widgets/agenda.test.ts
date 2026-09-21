import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@home-dash/shared";
import { buildAgenda } from "./agenda.js";

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
