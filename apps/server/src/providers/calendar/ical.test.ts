import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@home-dash/shared";
import { calendarIdFromUrl, fetchCalendars, parseFeed, parseFeedUrls, windowFor } from "./ical.js";

const LA = "America/Los_Angeles";
const fixture = readFileSync(
  fileURLToPath(new URL("./__fixtures__/household.ics", import.meta.url)),
  "utf8",
);

// Monday 21 September 2026, noon in Los Angeles.
const NOW = new Date("2026-09-21T19:00:00Z");
const window = windowFor(NOW, 7, LA);
const { name, events } = parseFeed(fixture, window, "household");

const byUid = (uid: string) => events.filter((e) => e.id === uid || e.id.startsWith(`${uid}_`));
const one = (uid: string): CalendarEvent => {
  const found = byUid(uid);
  expect(found, `expected exactly one "${uid}"`).toHaveLength(1);
  return found[0]!;
};

describe("windowFor", () => {
  it("runs from local midnight today for the requested number of days", () => {
    expect(window.startKey).toBe("2026-09-21");
    expect(window.endKey).toBe("2026-09-28");
    expect(window.start.toISOString()).toBe("2026-09-21T07:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-09-28T07:00:00.000Z");
  });
});

describe("parseFeed: single events", () => {
  it("reads the calendar's display name", () => {
    expect(name).toBe("Household");
  });

  it("maps a UTC event, unescaping text", () => {
    expect(one("single-utc")).toMatchObject({
      title: "Dentist",
      start: "2026-09-22T16:00:00.000Z",
      end: "2026-09-22T17:00:00.000Z",
      allDay: false,
      location: "Snoqualmie Ridge Dental, Suite 4",
      calendarId: "household",
    });
  });

  it("converts a TZID time using the feed's VTIMEZONE", () => {
    // 18:30 PDT on the 23rd is 01:30 UTC on the 24th.
    expect(one("single-tzid")).toMatchObject({
      start: "2026-09-24T01:30:00.000Z",
      end: "2026-09-24T03:00:00.000Z",
    });
  });

  it("keeps all-day events as dates with an exclusive end", () => {
    expect(one("allday-single")).toMatchObject({ start: "2026-09-25", end: "2026-09-26", allDay: true });
  });

  it("includes a multi-day all-day event that runs past the window", () => {
    expect(one("allday-multi")).toMatchObject({ start: "2026-09-26", end: "2026-10-01", allDay: true });
  });

  it("gives an all-day event with no DTEND a length of one day", () => {
    expect(one("allday-no-dtend")).toMatchObject({ start: "2026-09-27", end: "2026-09-28" });
  });

  it("includes an event already in progress when the window opens", () => {
    expect(one("in-progress").start).toBe("2026-09-20T23:00:00.000Z");
  });

  it("excludes events wholly before or after the window", () => {
    expect(byUid("before-window")).toHaveLength(0);
    expect(byUid("after-window")).toHaveLength(0);
  });

  it("drops cancelled events", () => {
    expect(byUid("cancelled-single")).toHaveLength(0);
  });

  it("titles an untitled event the way Google does", () => {
    expect(one("no-summary").title).toBe("(No title)");
  });

  it("unfolds a long line split across the file", () => {
    expect(one("folded").title).toBe(
      "A deliberately long event title that the calendar folds across more than one line of the file",
    );
  });

  // Floating times have no zone. ical.js would read them in the host's zone,
  // and the server runs in UTC under Docker.
  it("reads a floating time in the dashboard's timezone, not the host's", () => {
    expect(one("floating").start).toBe("2026-09-26T15:00:00.000Z");
    const ny = parseFeed(fixture, windowFor(NOW, 7, "America/New_York"), "household").events;
    expect(ny.find((e) => e.id === "floating")?.start).toBe("2026-09-26T12:00:00.000Z");
  });
});

describe("parseFeed: recurring events", () => {
  it("expands a weekly series and honours EXDATE", () => {
    expect(byUid("weekly-exdate").map((e) => e.start)).toEqual([
      "2026-09-21T16:00:00.000Z", // Monday
      // Wednesday the 23rd is excluded
      "2026-09-25T16:00:00.000Z", // Friday
    ]);
  });

  // The original Monday-28th slot is outside the window; the moved instance
  // lands inside it. Walking the series only to the window end would miss it.
  it("includes an instance moved into the window from outside it", () => {
    const planning = byUid("weekly-moved");
    expect(planning).toHaveLength(1);
    expect(planning[0]).toMatchObject({
      title: "Planning (moved to Friday)",
      start: "2026-09-25T21:00:00.000Z",
    });
  });

  it("excludes an instance moved out of the window", () => {
    expect(byUid("weekly-moved").some((e) => e.start.startsWith("2026-09-21"))).toBe(false);
  });

  it("drops a cancelled instance of a series", () => {
    expect(byUid("weekly-cancelled")).toHaveLength(0);
  });

  it("stops a COUNT-limited series when the count runs out", () => {
    expect(byUid("count-ended")).toHaveLength(0);
  });

  it("expands a yearly all-day series from decades back", () => {
    expect(one("yearly-birthday")).toMatchObject({ start: "2026-09-24", end: "2026-09-25", allDay: true });
  });

  it("expands a daily series running since 2022, one per day, at the right local time", () => {
    const walks = byUid("daily-long");
    expect(walks).toHaveLength(7);
    expect(walks.every((e) => e.start.endsWith("T14:00:00.000Z"))).toBe(true); // 07:00 PDT
  });

  it("gives every occurrence a distinct id", () => {
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });
});

describe("parseFeed: output", () => {
  it("returns exactly the expected events", () => {
    expect(events).toHaveLength(20);
  });

  it("sorts by start, with an all-day event ahead of timed events that day", () => {
    const starts = events.map((e) =>
      e.allDay ? Date.parse(`${e.start}T07:00:00Z`) : Date.parse(e.start),
    );
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe("parseFeedUrls", () => {
  it("splits, trims and drops empty entries from a hand-pasted value", () => {
    expect(parseFeedUrls(" https://a/x.ics ,https://b/y.ics,\n,")).toEqual(["https://a/x.ics", "https://b/y.ics"]);
  });

  it("treats a missing or empty value as no calendars", () => {
    expect(parseFeedUrls(undefined)).toEqual([]);
    expect(parseFeedUrls("")).toEqual([]);
  });
});

describe("calendarIdFromUrl", () => {
  it("names a Google feed by its calendar id and never includes the secret", () => {
    const url =
      "https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/private-0123456789abcdef/basic.ics";
    expect(calendarIdFromUrl(url)).toBe("abc123@group.calendar.google.com");
    expect(calendarIdFromUrl(url)).not.toContain("private");
  });

  it("falls back to the host for other providers", () => {
    expect(calendarIdFromUrl("https://p42-caldav.icloud.com/published/2/xyz")).toBe("p42-caldav.icloud.com");
  });
});

describe("fetchCalendars", () => {
  const SECRET = "private-0123456789abcdef";
  const url = (id: string) =>
    `https://calendar.google.com/calendar/ical/${id}%40group.calendar.google.com/${SECRET}/basic.ics`;
  const ok = () => new Response(fixture, { status: 200 });
  const asFetch = (impl: (u: string) => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch;

  it("merges several feeds and lists each calendar", async () => {
    const snapshot = await fetchCalendars([url("a"), url("b")], window, asFetch(async () => ok()));
    expect(snapshot.calendars.map((c) => c.id)).toEqual([
      "a@group.calendar.google.com",
      "b@group.calendar.google.com",
    ]);
    expect(snapshot.events).toHaveLength(40);
    expect(new Set(snapshot.events.map((e) => `${e.calendarId}/${e.id}`)).size).toBe(40);
  });

  // Stale-but-complete beats fresh-but-silently-missing-a-calendar: the cache
  // keeps serving the last good set, marked stale, rather than quietly dropping one.
  it("fails the whole refresh when any feed fails", async () => {
    const fetchImpl = asFetch(async (u) => (u.includes("/b%40") ? new Response("no", { status: 404 }) : ok()));
    await expect(fetchCalendars([url("a"), url("b")], window, fetchImpl)).rejects.toThrow(
      /b@group\.calendar\.google\.com.*404/,
    );
  });

  it("rejects a response that is not a calendar", async () => {
    const fetchImpl = asFetch(async () => new Response("<html>Not found</html>", { status: 200 }));
    await expect(fetchCalendars([url("a")], window, fetchImpl)).rejects.toThrow(/did not return a calendar/);
  });

  // Errors end up in /api/health and on the widget. The address is a credential.
  it.each([
    ["an HTTP error", async () => new Response("no", { status: 500 })],
    [
      "a network error that quotes the URL",
      async (u: string): Promise<Response> => {
        throw new Error(`connect ECONNREFUSED ${u}`);
      },
    ],
  ] as const)("never puts the secret address in the error for %s", async (_label, impl) => {
    const error = await fetchCalendars([url("a")], window, asFetch(impl)).catch((e: unknown) => e);
    expect(String(error)).not.toContain(SECRET);
    expect(String(error)).toContain("a@group.calendar.google.com");
  });
});
