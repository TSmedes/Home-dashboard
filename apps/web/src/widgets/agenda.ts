import type { CalendarEvent } from "@home-dash/shared";
import { addDays, clockTime, dateKey, noonOf } from "../lib/zoned.js";

export type When =
  | { kind: "allDay" }
  /** Starts at this time on this day. */
  | { kind: "at"; time: string; meridiem: string }
  /** Began before today and is still going; shows when it ends. */
  | { kind: "until"; time: string; meridiem: string };

export interface AgendaItem {
  /** Unique across calendars and across the days a multi-day event repeats on. */
  key: string;
  event: CalendarEvent;
  when: When;
  /** Happening right now - drawn with the amber "now" accent. */
  now: boolean;
}

export interface AgendaDay {
  dateKey: string;
  label: string;
  items: AgendaItem[];
}

function dayLabel(key: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const date = noonOf(key);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date);
  return `${weekday} ${date.getUTCDate()}`;
}

/**
 * Turn the server's flat event list into the days the wall should show.
 *
 * Everything is judged in the dashboard's timezone and against `now`, so the
 * agenda rolls over at local midnight and finished events drop off as the day
 * goes on, without waiting for the next fetch.
 */
export function buildAgenda(
  events: CalendarEvent[],
  now: Date,
  timezone: string,
  days: number,
  clock: "12h" | "24h",
): AgendaDay[] {
  const today = dateKey(now, timezone);
  const shown = Array.from({ length: days }, (_, i) => addDays(today, i));
  const byDay = new Map<string, AgendaItem[]>(shown.map((key) => [key, []]));
  const nowMs = now.getTime();

  for (const event of events) {
    const eventKey = `${event.calendarId}/${event.id}`;

    if (event.allDay) {
      // All-day dates are exclusive at the end: a Sat-Sun trip ends on Monday.
      for (const key of shown) {
        if (event.start <= key && key < event.end) {
          byDay.get(key)!.push({ key: `${eventKey}/${key}`, event, when: { kind: "allDay" }, now: false });
        }
      }
      continue;
    }

    const start = new Date(event.start);
    const end = new Date(event.end);
    if (end.getTime() <= nowMs) continue; // over

    const startedBeforeToday = dateKey(start, timezone) < today;
    const placedOn = startedBeforeToday ? today : dateKey(start, timezone);
    const items = byDay.get(placedOn);
    if (!items) continue; // beyond the days being shown

    items.push({
      key: `${eventKey}/${placedOn}`,
      event,
      when: startedBeforeToday
        ? { kind: "until", ...clockTime(end, timezone, clock) }
        : { kind: "at", ...clockTime(start, timezone, clock) },
      now: start.getTime() <= nowMs && nowMs < end.getTime(),
    });
  }

  return shown
    .map((key, index) => ({
      dateKey: key,
      label: dayLabel(key, index),
      items: byDay
        .get(key)!
        .sort(
          (a, b) =>
            Number(b.event.allDay) - Number(a.event.allDay) ||
            Date.parse(a.event.start) - Date.parse(b.event.start) ||
            a.event.title.localeCompare(b.event.title),
        ),
    }))
    .filter((day) => day.items.length > 0);
}
