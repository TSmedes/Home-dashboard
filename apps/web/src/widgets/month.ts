import type { CalendarEvent } from "@home-dash/shared";
import { addDays, clockTime, dateKey, daysBetween, noonOf } from "../lib/zoned.js";

/**
 * A month laid out the way a wall calendar is: seven columns, Monday first,
 * every cell a real date.
 *
 * The feed only reaches `daysAhead` from today, so this deliberately says
 * which months can be shown at all - a month the feed does not cover would
 * draw empty cells that look exactly like free days.
 */

/** A YYYY-MM month key. */
export type MonthKey = string;

export interface MonthItem {
  key: string;
  event: CalendarEvent;
  /** "9:00", or empty for an all-day event. */
  time: string;
}

export interface MonthDay {
  dateKey: string;
  dayOfMonth: number;
  /** False for the leading and trailing days borrowed from the months either side. */
  inMonth: boolean;
  isToday: boolean;
  /** Before today, so the feed holds nothing for it - drawn faint. */
  past: boolean;
  items: MonthItem[];
}

export const monthOf = (key: string): MonthKey => key.slice(0, 7);

export function addMonths(month: MonthKey, count: number): MonthKey {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const shifted = new Date(Date.UTC(year, index - 1 + count, 1));
  return shifted.toISOString().slice(0, 7);
}

export function daysInMonth(month: MonthKey): number {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

/** "September 2026". */
export function monthLabel(month: MonthKey): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    noonOf(`${month}-01`),
  );
}

/** Monday is column 0, the way the grid is drawn. */
function weekdayIndex(key: string): number {
  return (noonOf(key).getUTCDay() + 6) % 7;
}

/**
 * The months worth offering arrows to: this one, and every later month the
 * feed covers all the way to its last day. Never fewer than two, because
 * `calendar.daysAhead` is set wide enough to reach the end of next month.
 */
export function reachableMonths(todayKey: string, daysAhead: number): MonthKey[] {
  const lastCovered = addDays(todayKey, daysAhead - 1);
  const months = [monthOf(todayKey)];
  for (let next = addMonths(months[0]!, 1); ; next = addMonths(next, 1)) {
    const endOfMonth = `${next}-${String(daysInMonth(next)).padStart(2, "0")}`;
    if (endOfMonth > lastCovered) break;
    months.push(next);
  }
  return months;
}

/** The local calendar dates an event touches, both YYYY-MM-DD and inclusive. */
function eventDays(event: CalendarEvent, timezone: string): [string, string] {
  if (event.allDay) {
    // All-day ends are exclusive: a Sat-Sun trip ends on Monday.
    const last = daysBetween(event.start, event.end) > 0 ? addDays(event.end, -1) : event.start;
    return [event.start, last];
  }
  const start = dateKey(new Date(event.start), timezone);
  // A meeting ending at midnight belongs to the day it ran in, not the next.
  const end = dateKey(new Date(Date.parse(event.end) - 1), timezone);
  return [start, end < start ? start : end];
}

/** Every event touching a calendar date, all-day first, then by start time. */
export function eventsOn(events: CalendarEvent[], key: string, timezone: string): CalendarEvent[] {
  return events
    .filter((event) => {
      const [from, to] = eventDays(event, timezone);
      return from <= key && key <= to;
    })
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        Date.parse(a.start) - Date.parse(b.start) ||
        a.title.localeCompare(b.title),
    );
}

/**
 * The weeks of `month`, each seven days long, padded at both ends with the
 * neighbouring months' days so the 1st lands on its real weekday.
 */
export function monthGrid(
  month: MonthKey,
  events: CalendarEvent[],
  todayKey: string,
  timezone: string,
  clock: "12h" | "24h",
): MonthDay[][] {
  const first = `${month}-01`;
  const lead = weekdayIndex(first);
  const total = Math.ceil((lead + daysInMonth(month)) / 7) * 7;
  const start = addDays(first, -lead);

  const days: MonthDay[] = Array.from({ length: total }, (_, i) => {
    const key = addDays(start, i);
    return {
      dateKey: key,
      dayOfMonth: Number(key.slice(8)),
      inMonth: monthOf(key) === month,
      isToday: key === todayKey,
      past: key < todayKey,
      items: eventsOn(events, key, timezone).map((event) => ({
        key: `${event.calendarId}/${event.id}/${key}`,
        event,
        // Only the day it starts on carries a time; later days are a
        // continuation, and repeating the start time there would read as a
        // second appointment.
        time:
          event.allDay || eventDays(event, timezone)[0] !== key
            ? ""
            : clockTime(new Date(event.start), timezone, clock).time,
      })),
    };
  });

  return Array.from({ length: total / 7 }, (_, week) => days.slice(week * 7, week * 7 + 7));
}
