import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/snoqualmie.json" with { type: "json" };
import { searchPlaces } from "./openMeteo.js";

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("searchPlaces", () => {
  it("maps a recorded live response into places", async () => {
    const places = await searchPlaces("Snoqualmie", respond(fixture));
    expect(places[0]).toEqual({
      label: "Snoqualmie, Washington",
      detail: "United States",
      lat: 47.52871,
      lon: -121.82539,
      timezone: "America/Los_Angeles",
    });
    expect(places.map((p) => p.label)).toContain("North Bend, Washington");
  });

  // Open-Meteo omits the results key entirely when nothing matches.
  it("returns an empty list when nothing matches", async () => {
    expect(await searchPlaces("zzqxnotaplace", respond({ generationtime_ms: 0.4 }))).toEqual([]);
  });

  it("does not search for one stray character", async () => {
    const fetchImpl = respond(fixture);
    expect(await searchPlaces(" s ", fetchImpl)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks for the typed name and no API key", async () => {
    const fetchImpl = respond(fixture);
    await searchPlaces("Fall City", fetchImpl);
    const url = new URL(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]));
    expect(url.hostname).toBe("geocoding-api.open-meteo.com");
    expect(url.searchParams.get("name")).toBe("Fall City");
    expect(url.search).not.toMatch(/key|apikey/i);
  });

  it("skips a result with no timezone, which the dashboard could not use", async () => {
    const results = [{ ...fixture.results[0], timezone: undefined }, fixture.results[1]];
    const places = await searchPlaces("x".repeat(3), respond({ results }));
    expect(places.map((p) => p.label)).toEqual(["North Bend, Washington"]);
  });

  it("reports a failed search with its status", async () => {
    await expect(searchPlaces("Snoqualmie", respond({}, 503))).rejects.toThrow(/503/);
  });
});
