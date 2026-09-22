import { describe, expect, it, vi } from "vitest";
import type { Location, Units } from "@home-dash/shared";
import fixture from "./__fixtures__/open-meteo.snoqualmie.json" with { type: "json" };
import { buildUrl, fetchWeather, mapResponse, type OpenMeteoResponse } from "./openMeteo.js";

const location: Location = {
  name: "Snoqualmie, WA",
  lat: 47.5287,
  lon: -121.8254,
  timezone: "America/Los_Angeles",
};
const units: Units = { temperature: "fahrenheit", wind: "mph", clock: "12h" };
const raw = fixture as unknown as OpenMeteoResponse;

describe("buildUrl", () => {
  it("requests the configured location, units and timezone", () => {
    const url = new URL(buildUrl(location, units));
    expect(url.searchParams.get("latitude")).toBe("47.5287");
    expect(url.searchParams.get("longitude")).toBe("-121.8254");
    expect(url.searchParams.get("temperature_unit")).toBe("fahrenheit");
    expect(url.searchParams.get("wind_speed_unit")).toBe("mph");
    expect(url.searchParams.get("timezone")).toBe("America/Los_Angeles");
    expect(url.searchParams.get("forecast_days")).toBe("10");
  });

  it("asks for inches with Fahrenheit and millimetres with Celsius", () => {
    expect(new URL(buildUrl(location, units)).searchParams.get("precipitation_unit")).toBe("inch");
    const metric: Units = { temperature: "celsius", wind: "kmh", clock: "24h" };
    expect(new URL(buildUrl(location, metric)).searchParams.get("precipitation_unit")).toBe("mm");
  });

  it("requires no API key, so nothing secret ends up in the URL", () => {
    expect(buildUrl(location, units)).not.toMatch(/key|token|appid/i);
  });
});

describe("mapResponse", () => {
  it("maps current conditions from a recorded live response", () => {
    const snapshot = mapResponse(raw, units);
    expect(snapshot.now).toEqual({
      temperature: 65,
      apparentTemperature: 66,
      humidity: 74,
      windSpeed: 5,
      windDirection: 340,
      precipitation: 0,
      isDay: true,
      code: 3,
      uvIndex: 0.2,
    });
  });

  it("flattens the parallel hourly arrays into objects", () => {
    const snapshot = mapResponse(raw, units);
    expect(snapshot.hourly).toHaveLength(raw.hourly.time.length);
    expect(snapshot.hourly[0]).toMatchObject({
      time: raw.hourly.time[0],
      temperature: Math.round(raw.hourly.temperature_2m[0]!),
      code: raw.hourly.weather_code[0],
      precipitation: 0,
      humidity: 76,
      windSpeed: 4,
      uvIndex: 0,
    });
  });

  it("produces a seven-day outlook with sunrise and sunset", () => {
    const snapshot = mapResponse(raw, units);
    expect(snapshot.daily).toHaveLength(7);
    expect(snapshot.daily[0]).toMatchObject({ date: "2026-09-21", max: 67, sunrise: "2026-09-21T06:52" });
    expect(snapshot.daily[0]!.min).toBeLessThanOrEqual(snapshot.daily[0]!.max);
  });

  it("carries rain totals, wind and UV for the detailed forecast", () => {
    expect(mapResponse(raw, units).daily[3]).toMatchObject({
      precipitationSum: 0.921,
      windSpeedMax: 4,
      windDirection: 240,
      uvIndexMax: 3.2,
    });
  });

  it("reads zero for a field an older response does not have", () => {
    const { uv_index_max: _dropped, ...daily } = raw.daily;
    expect(mapResponse({ ...raw, daily }, units).daily[0]!.uvIndexMax).toBe(0);
  });

  it("labels units for the display layer", () => {
    expect(mapResponse(raw, units).units).toEqual({ temperature: "°F", wind: "mph", precipitation: "in" });
    expect(mapResponse(raw, { temperature: "celsius", wind: "kmh", clock: "24h" }).units.temperature).toBe("°C");
  });

  it("survives short arrays without throwing", () => {
    const truncated = {
      ...raw,
      hourly: { ...raw.hourly, temperature_2m: [], precipitation_probability: [], weather_code: [] },
    } as OpenMeteoResponse;
    expect(() => mapResponse(truncated, units)).not.toThrow();
    expect(mapResponse(truncated, units).hourly[0]!.temperature).toBe(0);
  });
});

describe("fetchWeather", () => {
  it("returns a mapped snapshot on success", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const snapshot = await fetchWeather(location, units, 7, fetchImpl as unknown as typeof fetch);
    expect(snapshot.now.temperature).toBe(65);
  });

  it("throws with the status code so the cache can show a useful error", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503, statusText: "Service Unavailable" }));
    await expect(fetchWeather(location, units, 7, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/503/);
  });
});
