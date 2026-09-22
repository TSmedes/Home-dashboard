import { describe, expect, it, vi } from "vitest";
import gaugeFixture from "./__fixtures__/SQUW1.gauge.json" with { type: "json" };
import stageflowFixture from "./__fixtures__/SQUW1.stageflow.json" with { type: "json" };
import { categoryFor, fetchGauge, fetchRivers, mapGauge, type NwpsGauge, type NwpsStageFlow } from "./nwps.js";

const gauge = gaugeFixture as NwpsGauge;
const stageflow = stageflowFixture as NwpsStageFlow;
/** Just after the last observation in the recorded response. */
const now = new Date("2026-09-22T01:00:00Z");

describe("mapGauge", () => {
  const snapshot = mapGauge(gauge, stageflow, now);

  it("judges Snoqualmie Falls by flow, because its thresholds are flows", () => {
    expect(snapshot.measure).toBe("flow");
    expect(snapshot.unit).toBe("cfs");
    expect(snapshot.thresholds).toEqual({ action: 15000, minor: 20000, moderate: 31000, major: 41000 });
  });

  it("converts the latest reading from kcfs to cfs", () => {
    expect(snapshot.current).toEqual({ time: "2026-09-22T00:30:00Z", value: 365 });
    expect(snapshot.category).toBe("none");
    expect(snapshot.name).toBe("Snoqualmie River at Snoqualmie Falls");
  });

  it("keeps only 48 hours of observations, thinned for a sparkline", () => {
    expect(snapshot.observed.length).toBeLessThanOrEqual(97);
    expect(Date.parse(snapshot.observed[0]!.time)).toBeGreaterThanOrEqual(now.getTime() - 48 * 3_600_000);
    expect(snapshot.observed.at(-1)).toEqual(snapshot.current);
  });

  it("treats only values after the latest reading as the forecast", () => {
    expect(snapshot.forecast.length).toBeGreaterThan(0);
    for (const p of snapshot.forecast) expect(Date.parse(p.time)).toBeGreaterThan(Date.parse(snapshot.current!.time));
    expect(snapshot.forecastPeak!.value).toBe(Math.max(...snapshot.forecast.map((p) => p.value)));
  });

  it("reports the change over six hours", () => {
    expect(typeof snapshot.change6h).toBe("number");
  });

  it("falls back to stage when a gauge has only stage thresholds", () => {
    const stageOnly: NwpsGauge = {
      lid: "TEST1",
      name: "Test",
      flood: { categories: { minor: { stage: 10, flow: -9999 }, major: { stage: 14, flow: -9999 } } },
    };
    const result = mapGauge(stageOnly, stageflow, now);
    expect(result.measure).toBe("stage");
    expect(result.unit).toBe("ft");
    expect(result.current).toEqual({ time: "2026-09-22T00:30:00Z", value: 2.2 });
    expect(result.thresholds).toEqual({ minor: 10, major: 14 });
  });

  it("copes with a gauge that has not reported", () => {
    const result = mapGauge(gauge, { observed: null, forecast: null }, now);
    expect(result.current).toBeNull();
    expect(result.change6h).toBeNull();
    expect(result.forecastPeak).toBeNull();
    expect(result.category).toBe("none");
  });
});

describe("categoryFor", () => {
  const thresholds = { action: 15000, minor: 20000, moderate: 31000, major: 41000 };
  it("picks the highest threshold reached", () => {
    expect(categoryFor(14999, thresholds)).toBe("none");
    expect(categoryFor(15000, thresholds)).toBe("action");
    expect(categoryFor(25000, thresholds)).toBe("minor");
    expect(categoryFor(50000, thresholds)).toBe("major");
  });
});

describe("fetchGauge", () => {
  it("reads the gauge and its series without a key", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const body = String(url).endsWith("/stageflow") ? stageflow : gauge;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const snapshot = await fetchGauge("squw1", fetcher as typeof fetch, now);
    expect(snapshot.current?.value).toBe(365);
    expect(fetcher.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://api.water.noaa.gov/nwps/v1/gauges/SQUW1",
      "https://api.water.noaa.gov/nwps/v1/gauges/SQUW1/stageflow",
    ]);
  });

  it("says plainly when the gauge id is wrong", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(fetchGauge("NOPE1", fetcher as typeof fetch, now)).rejects.toThrow(/no gauge at NOPE1/);
  });
});

describe("fetchRivers", () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const text = String(url);
    if (text.includes("NOPE1")) return new Response("{}", { status: 404 });
    const lid = text.split("/gauges/")[1]!.split("/")[0]!;
    const body = text.endsWith("/stageflow") ? stageflow : { ...gauge, lid };
    return new Response(JSON.stringify(body), { status: 200 });
  });

  it("reads every gauge, in the order asked for", async () => {
    const snapshot = await fetchRivers(["SNQW1", "TANW1", "GARW1"], fetcher as typeof fetch, now);
    expect(snapshot.gauges.map((g) => g.gauge)).toEqual(["SNQW1", "TANW1", "GARW1"]);
    expect(snapshot.failed).toEqual([]);
  });

  it("keeps the gauges that answered when one does not", async () => {
    const snapshot = await fetchRivers(["SNQW1", "NOPE1"], fetcher as typeof fetch, now);
    expect(snapshot.gauges.map((g) => g.gauge)).toEqual(["SNQW1"]);
    expect(snapshot.failed).toEqual([{ gauge: "NOPE1", message: expect.stringMatching(/no gauge at NOPE1/) }]);
  });

  it("fails the refresh only when every gauge fails", async () => {
    await expect(fetchRivers(["NOPE1"], fetcher as typeof fetch, now)).rejects.toThrow(/NOPE1/);
  });
});
