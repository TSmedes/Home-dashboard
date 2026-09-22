import { describe, expect, it, vi } from "vitest";
import type { CommuteDestination, Location } from "@home-dash/shared";
import { fetchCommute, mapRoute, routeUrl, TomTomAuthError } from "./tomtom.js";

const home: Location = { name: "Snoqualmie, WA", lat: 47.5287, lon: -121.8254, timezone: "America/Los_Angeles" };
const office: CommuteDestination = { id: "office", name: "Office", lat: 47.6101, lon: -122.2015 };
const school: CommuteDestination = { id: "school", name: "School", lat: 47.53, lon: -121.87 };
const KEY = "secret-key-123";

/** The shape of a live calculateRoute response, trimmed to what is read. */
const ok = (travel: number, delay: number) => ({
  formatVersion: "0.0.12",
  routes: [
    {
      summary: {
        lengthInMeters: 41250,
        travelTimeInSeconds: travel,
        trafficDelayInSeconds: delay,
        departureTime: "2026-09-21T08:00:00-07:00",
        arrivalTime: "2026-09-21T08:34:10-07:00",
      },
    },
  ],
});

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("routeUrl", () => {
  it("routes from home to the destination with live traffic", () => {
    const url = new URL(routeUrl(home, office, KEY));
    expect(url.pathname).toBe("/routing/1/calculateRoute/47.5287,-121.8254:47.6101,-122.2015/json");
    expect(url.searchParams.get("traffic")).toBe("true");
    expect(url.searchParams.get("departAt")).toBe("now");
  });
});

describe("mapRoute", () => {
  it("reads the travel time, the traffic delay and the arrival", () => {
    expect(mapRoute(office, ok(2050, 310))).toEqual({
      id: "office",
      name: "Office",
      travelSeconds: 2050,
      delaySeconds: 310,
      lengthMeters: 41250,
      arrival: "2026-09-21T15:34:10.000Z",
    });
  });
});

describe("fetchCommute", () => {
  it("returns every destination that routed and lists the ones that did not", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("47.53,-121.87") ? respond(400, { detailedError: { message: "Point is in water" } }) : respond(200, ok(2050, 0)),
    );
    const snapshot = await fetchCommute(home, [office, school], KEY, fetcher as typeof fetch);
    expect(snapshot.routes.map((r) => r.id)).toEqual(["office"]);
    expect(snapshot.failed).toEqual([{ id: "school", name: "School", message: "TomTom could not route there: Point is in water" }]);
  });

  it("fails the refresh on a refused key, so the last good times stay up", async () => {
    const fetcher = vi.fn(async () => respond(403, {}));
    await expect(fetchCommute(home, [office], KEY, fetcher as typeof fetch)).rejects.toBeInstanceOf(TomTomAuthError);
  });

  it("never puts the key in an error", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      throw new Error(`fetch failed for ${String(url)}`);
    });
    const error = await fetchCommute(home, [office], KEY, fetcher as typeof fetch).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(KEY);
  });
});
