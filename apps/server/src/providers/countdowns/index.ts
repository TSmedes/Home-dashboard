import type { CalendarEvent, Countdown, CountdownsSnapshot, DashboardConfig } from "@home-dash/shared";
import { dateKeyInZone } from "../../lib/zonedTime.js";
import { fetchCalendars, windowFor } from "../calendar/ical.js";

/**
 * Days-until for the things the house is looking forward to. They come from
 * two places: dates written in config.yaml, and calendar events carrying the
 * countdown tag, so adding one from a phone's calendar app just works.
 *
 * Tagged events are read with their own long window, separate from the
 * agenda's week, because the point of a countdown is that it is far away.
 */

const MAX_COUNTDOWNS = 20;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The event's local start date, YYYY-MM-DD. */
function startKey(event: CalendarEvent, timezone: string): string {
  return event.allDay ? event.start : dateKeyInZone(new Date(event.start), timezone);
}

/**
 * Tagged events as countdowns, with the tag taken out of the name. A
 * repeating event - a birthday - counts down only to its next occurrence.
 */
export function fromCalendar(events: CalendarEvent[], tag: string, timezone: string): Countdown[] {
  const pattern = new RegExp(`\\s*${escapeRegExp(tag)}\\s*`, "i");
  const seen = new Set<string>();
  const countdowns: Countdown[] = [];

  for (const event of events) {
    if (!pattern.test(event.title)) continue;
    const name = event.title.replace(pattern, " ").replace(/\s+/g, " ").trim() || "Untitled";
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    countdowns.push({ id: `calendar:${event.id}`, name, date: startKey(event, timezone), source: "calendar" });
  }
  return countdowns;
}

/** Config and calendar countdowns merged: nothing past, soonest first. */
export function mergeCountdowns(
  config: DashboardConfig["countdowns"],
  calendar: Countdown[],
  today: string,
): Countdown[] {
  const configured: Countdown[] = config.items.map((item, i) => ({
    id: `config:${i}`,
    name: item.name,
    date: item.date,
    ...(item.emoji ? { emoji: item.emoji } : {}),
    source: "config",
  }));

  return [...configured, ...calendar]
    .filter((c) => c.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
    .slice(0, MAX_COUNTDOWNS);
}

export async function fetchCountdowns(
  config: DashboardConfig,
  feedUrls: string[],
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<CountdownsSnapshot> {
  const timezone = config.location.timezone;
  let calendar: Countdown[] = [];
  if (feedUrls.length > 0) {
    const snapshot = await fetchCalendars(feedUrls, windowFor(now, config.countdowns.daysAhead, timezone), fetchImpl);
    calendar = fromCalendar(snapshot.events, config.countdowns.calendarTag, timezone);
  }
  return { countdowns: mergeCountdowns(config.countdowns, calendar, dateKeyInZone(now, timezone)) };
}
