import ICAL from "ical.js";
import type { CalendarEvent, CalendarSnapshot } from "@home-dash/shared";
import { addDays, dateKeyInZone, wallTimeToInstant, zonedMidnight } from "../../lib/zonedTime.js";

/**
 * Reads calendars from iCal feeds - in practice, the secret address Google
 * Calendar publishes for each calendar. Read-only by nature; adding events
 * needs Google OAuth, which is parked in FUTURE.md.
 *
 * The hard part is recurrence. A feed holds rules, not instances, so every
 * series is expanded here, honouring EXDATE removals, RECURRENCE-ID edits
 * (including an instance moved into or out of the window) and cancellations.
 */

export interface FeedWindow {
  /** First local date shown, YYYY-MM-DD. */
  startKey: string;
  /** Local date after the last one shown (exclusive), YYYY-MM-DD. */
  endKey: string;
  start: Date;
  end: Date;
  timezone: string;
}

/** Local midnight today, for `daysAhead` days, in the dashboard's timezone. */
export function windowFor(now: Date, daysAhead: number, timezone: string): FeedWindow {
  const startKey = dateKeyInZone(now, timezone);
  const endKey = addDays(startKey, daysAhead);
  return {
    startKey,
    endKey,
    start: zonedMidnight(startKey, timezone),
    end: zonedMidnight(endKey, timezone),
    timezone,
  };
}

/**
 * Occurrences walked per series before giving up. A daily rule started in 2000
 * needs about ten thousand; this guards against a pathological rule rather than
 * limiting any real calendar.
 */
const MAX_OCCURRENCES = 50_000;

type Moment = { allDay: true; key: string } | { allDay: false; at: Date };

const pad = (n: number) => String(n).padStart(2, "0");

function isFloating(time: ICAL.Time): boolean {
  return !time.zone || time.zone === ICAL.Timezone.localTimezone || time.zone.tzid === "floating";
}

/**
 * ical.js resolves a floating time (no TZID, no Z) through `new Date(y, m, d…)`,
 * i.e. in the host's zone. The server runs in UTC under Docker, so a floating
 * 8am event would land at 1am. Floating times are read in the dashboard's zone.
 */
function momentOf(time: ICAL.Time, timezone: string): Moment {
  if (time.isDate) return { allDay: true, key: `${time.year}-${pad(time.month)}-${pad(time.day)}` };
  if (isFloating(time)) {
    return {
      allDay: false,
      at: wallTimeToInstant(time.year, time.month, time.day, time.hour, time.minute, time.second, timezone),
    };
  }
  return { allDay: false, at: time.toJSDate() };
}

function instant(moment: Moment, timezone: string): number {
  return moment.allDay ? zonedMidnight(moment.key, timezone).getTime() : moment.at.getTime();
}

/** A missing or backwards end becomes one day (all-day) or zero length (timed). */
function settleEnd(start: Moment, end: Moment, timezone: string): Moment {
  if (instant(end, timezone) > instant(start, timezone)) return end;
  return start.allDay ? { allDay: true, key: addDays(start.key, 1) } : start;
}

function overlaps(start: Moment, end: Moment, window: FeedWindow): boolean {
  if (start.allDay && end.allDay) return start.key < window.endKey && end.key > window.startKey;
  const s = instant(start, window.timezone);
  const e = Math.max(instant(end, window.timezone), s + 1); // a zero-length event still occupies its moment
  return s < window.end.getTime() && e > window.start.getTime();
}

const serialise = (moment: Moment) => (moment.allDay ? moment.key : moment.at.toISOString());

function isCancelled(component: ICAL.Component): boolean {
  return String(component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
}

function toEvent(id: string, calendarId: string, item: ICAL.Event, start: Moment, end: Moment): CalendarEvent {
  const location = item.location?.trim();
  return {
    id,
    calendarId,
    title: item.summary?.trim() || "(No title)",
    start: serialise(start),
    end: serialise(end),
    allDay: start.allDay,
    ...(location ? { location } : {}),
  };
}

/** Both forms ical.js itself uses to match an occurrence to its edit. */
function recurrenceKeys(time: ICAL.Time): string[] {
  return [time.toString(), time.convertToZone(ICAL.Timezone.utcTimezone).toString()];
}

export function parseFeed(
  text: string,
  window: FeedWindow,
  calendarId: string,
): { name: string; events: CalendarEvent[] } {
  const root = new ICAL.Component(ICAL.parse(text));

  // Must happen before any event time is read, or TZID times resolve as floating.
  for (const zone of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(zone);

  const name = String(root.getFirstPropertyValue("x-wr-calname") ?? calendarId);
  const tz = window.timezone;

  // Split each series into its master and its edited instances.
  const masters: [string, ICAL.Component][] = [];
  const edits = new Map<string, ICAL.Component[]>();
  root.getAllSubcomponents("vevent").forEach((component, index) => {
    const uid = String(component.getFirstPropertyValue("uid") ?? `event-${index}`);
    if (component.hasProperty("recurrence-id")) {
      edits.set(uid, [...(edits.get(uid) ?? []), component]);
    } else {
      masters.push([uid, component]);
    }
  });

  const events: CalendarEvent[] = [];

  const emitEdit = (uid: string, component: ICAL.Component) => {
    if (isCancelled(component)) return;
    const edit = new ICAL.Event(component);
    const start = momentOf(edit.startDate, tz);
    const end = settleEnd(start, momentOf(edit.endDate, tz), tz);
    // Judged on where the instance now sits, not where the series put it -
    // which is what catches an instance moved into the window from outside.
    if (overlaps(start, end, window)) {
      events.push(toEvent(`${uid}_${edit.recurrenceId.toString()}`, calendarId, edit, start, end));
    }
  };

  for (const [uid, component] of masters) {
    const seriesEdits = edits.get(uid) ?? [];
    edits.delete(uid);
    if (isCancelled(component)) continue;

    const event = new ICAL.Event(component);

    if (!event.isRecurring()) {
      const start = momentOf(event.startDate, tz);
      const end = settleEnd(start, momentOf(event.endDate, tz), tz);
      if (overlaps(start, end, window)) events.push(toEvent(uid, calendarId, event, start, end));
      continue;
    }

    const edited = new Set<string>();
    for (const edit of seriesEdits) {
      event.relateException(edit);
      for (const key of recurrenceKeys(new ICAL.Event(edit).recurrenceId)) edited.add(key);
    }

    // Never pass a start time to iterator(): ical.js uses it as a new DTSTART,
    // which re-anchors the series and shifts every biweekly or monthly rule.
    // Walking from the real DTSTART is the only correct way in.
    const occurrences = event.iterator();
    for (let n = 0; n < MAX_OCCURRENCES; n++) {
      const next = occurrences.next();
      if (!next) break;
      if (instant(momentOf(next, tz), tz) >= window.end.getTime()) break;
      if (recurrenceKeys(next).some((key) => edited.has(key))) continue; // emitted below

      const details = event.getOccurrenceDetails(next);
      const start = momentOf(details.startDate, tz);
      const end = settleEnd(start, momentOf(details.endDate, tz), tz);
      if (overlaps(start, end, window)) {
        events.push(toEvent(`${uid}_${next.toString()}`, calendarId, event, start, end));
      }
    }

    for (const edit of seriesEdits) emitEdit(uid, edit);
  }

  // Edits whose series is not in the feed, e.g. one instance shared on its own.
  for (const [uid, orphans] of edits) for (const edit of orphans) emitEdit(uid, edit);

  return { name, events: sortEvents(events, tz) };
}

function sortEvents(events: CalendarEvent[], timezone: string): CalendarEvent[] {
  const key = (e: CalendarEvent) =>
    e.allDay ? zonedMidnight(e.start, timezone).getTime() : Date.parse(e.start);
  return events.sort(
    (a, b) =>
      key(a) - key(b) ||
      Number(b.allDay) - Number(a.allDay) || // all-day first on the same day
      a.title.localeCompare(b.title),
  );
}

/**
 * The comma-separated addresses from .env. Tolerates the stray whitespace and
 * trailing commas that come with pasting long URLs by hand.
 */
export function parseFeedUrls(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

const GOOGLE_FEED = "https://calendar.google.com/calendar/ical/";

/**
 * A name for a feed that is safe to show. The secret part of the address is a
 * credential, so logs, errors and the dashboard only ever see this.
 */
export function calendarIdFromUrl(url: string): string {
  if (url.startsWith(GOOGLE_FEED)) {
    return decodeURIComponent(url.slice(GOOGLE_FEED.length).split("/")[0] ?? "calendar");
  }
  try {
    return new URL(url).host;
  } catch {
    return "calendar";
  }
}

/** Strip anything that could be the secret address out of an error message. */
function scrub(cause: unknown, url: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.split(url).join("[secret address]").replace(/private-[^/\s]+/g, "private-…");
}

/**
 * Fetch and merge every feed. If any feed fails, the whole refresh fails: the
 * cache then keeps serving the last complete set, marked stale, which is better
 * than a fresh-looking agenda that has silently lost a calendar.
 */
export async function fetchCalendars(
  urls: string[],
  window: FeedWindow,
  fetchImpl: typeof fetch = fetch,
): Promise<CalendarSnapshot> {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const id = calendarIdFromUrl(url);
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`the server returned ${response.status}`);
        const text = await response.text();
        if (!text.trimStart().startsWith("BEGIN:VCALENDAR")) {
          throw new Error("did not return a calendar; the address may have been reset");
        }
        return { id, ...parseFeed(text, window, id) };
      } catch (cause) {
        throw new Error(`${id}: ${scrub(cause, url)}`);
      }
    }),
  );

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    throw new Error(failures.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason))).join("; "));
  }

  const feeds = results.map((r) => (r as PromiseFulfilledResult<{ id: string; name: string; events: CalendarEvent[] }>).value);
  return {
    calendars: feeds.map(({ id, name }) => ({ id, name })),
    events: sortEvents(
      feeds.flatMap((feed) => feed.events),
      window.timezone,
    ),
  };
}
