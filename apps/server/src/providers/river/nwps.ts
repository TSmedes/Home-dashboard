import type { FloodCategory, RiverGauge, RiverPoint, RiverSnapshot } from "@home-dash/shared";

/**
 * River levels from NOAA's National Water Prediction Service. Free, no key,
 * and it publishes the flood thresholds and the forecast alongside the
 * readings, which is what makes a number on the wall mean something.
 */

const API = "https://api.water.noaa.gov/nwps/v1";

/** NWPS writes -9999 for a threshold the gauge does not have. */
const MISSING = -9999;

const CATEGORIES = ["action", "minor", "moderate", "major"] as const;

export interface NwpsGauge {
  lid: string;
  name: string;
  flood?: {
    stageUnits?: string;
    flowUnits?: string;
    categories?: Partial<Record<(typeof CATEGORIES)[number], { stage?: number; flow?: number }>>;
  };
}

interface NwpsSeries {
  primaryName?: string;
  primaryUnits?: string;
  secondaryName?: string;
  secondaryUnits?: string;
  data?: { validTime: string; primary: number; secondary: number }[];
}

export interface NwpsStageFlow {
  observed?: NwpsSeries | null;
  forecast?: NwpsSeries | null;
}

const OBSERVED_WINDOW_MS = 48 * 3_600_000;
const CHANGE_WINDOW_MS = 6 * 3_600_000;

const valid = (n: number | undefined): n is number => typeof n === "number" && n !== MISSING && n >= 0;

/** Values in the series for `measure`, converted to cfs or ft. */
function pointsOf(series: NwpsSeries | null | undefined, measure: "flow" | "stage"): RiverPoint[] {
  if (!series?.data) return [];
  const pick = (units: string | undefined) =>
    measure === "flow" ? units === "kcfs" || units === "cfs" : units === "ft";
  const slot = pick(series.primaryUnits) ? "primary" : pick(series.secondaryUnits) ? "secondary" : null;
  if (!slot) return [];
  const units = slot === "primary" ? series.primaryUnits : series.secondaryUnits;
  const scale = units === "kcfs" ? 1000 : 1;

  return series.data
    .filter((d) => valid(d[slot]))
    .map((d) => ({ time: d.validTime, value: roundFor(measure, d[slot] * scale) }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function roundFor(measure: "flow" | "stage", value: number): number {
  return measure === "flow" ? Math.round(value) : Math.round(value * 100) / 100;
}

export function categoryFor(
  value: number | undefined,
  thresholds: RiverGauge["thresholds"],
): FloodCategory {
  if (value === undefined) return "none";
  let category: FloodCategory = "none";
  for (const name of CATEGORIES) {
    const at = thresholds[name];
    if (at !== undefined && value >= at) category = name;
  }
  return category;
}

/**
 * Flood thresholds decide the measure. Snoqualmie Falls, for instance, is
 * judged by flow and has no stage thresholds at all, so showing its stage
 * would give a number with nothing to compare it against.
 */
export function mapGauge(gauge: NwpsGauge, stageflow: NwpsStageFlow, now: Date): RiverGauge {
  const categories = gauge.flood?.categories ?? {};
  const has = (measure: "flow" | "stage") => CATEGORIES.some((c) => valid(categories[c]?.[measure]));
  const measure: "flow" | "stage" = has("flow") || !has("stage") ? "flow" : "stage";

  const thresholds: RiverGauge["thresholds"] = {};
  for (const name of CATEGORIES) {
    const at = categories[name]?.[measure];
    if (valid(at)) thresholds[name] = at;
  }

  const cutoff = now.getTime() - OBSERVED_WINDOW_MS;
  const allObserved = pointsOf(stageflow.observed, measure);
  const observed = allObserved.filter((p) => Date.parse(p.time) >= cutoff);
  const current = allObserved.at(-1) ?? null;

  // Only forecast values still ahead of the latest reading are a forecast.
  const after = current ? Date.parse(current.time) : now.getTime();
  const forecast = pointsOf(stageflow.forecast, measure).filter((p) => Date.parse(p.time) > after);
  const forecastPeak = forecast.reduce<RiverPoint | null>((peak, p) => (!peak || p.value > peak.value ? p : peak), null);

  let change6h: number | null = null;
  if (current) {
    const target = Date.parse(current.time) - CHANGE_WINDOW_MS;
    const earlier = allObserved.findLast((p) => Date.parse(p.time) <= target);
    if (earlier) change6h = roundFor(measure, current.value - earlier.value);
  }

  return {
    gauge: gauge.lid,
    name: gauge.name,
    measure,
    unit: measure === "flow" ? "cfs" : "ft",
    current,
    change6h,
    category: categoryFor(current?.value, thresholds),
    thresholds,
    forecastPeak,
    observed: thin(observed, 96),
    forecast,
  };
}

/** Every nth point, keeping the last, so a 15-minute series fits a sparkline. */
function thin(points: RiverPoint[], max: number): RiverPoint[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const kept = points.filter((_, i) => i % step === 0);
  if (kept.at(-1) !== points.at(-1)) kept.push(points.at(-1)!);
  return kept;
}

async function getJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  if (response.status === 404) throw new Error(`NOAA has no gauge at ${url.split("/gauges/")[1]}; check the gauge id on water.noaa.gov`);
  if (!response.ok) throw new Error(`NOAA water service returned ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchGauge(gauge: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<RiverGauge> {
  const id = encodeURIComponent(gauge.toUpperCase());
  const [meta, stageflow] = await Promise.all([
    getJson<NwpsGauge>(`${API}/gauges/${id}`, fetcher),
    getJson<NwpsStageFlow>(`${API}/gauges/${id}/stageflow`, fetcher),
  ]);
  return mapGauge(meta, stageflow, now);
}

/**
 * Every gauge, read independently: one gauge that NOAA has dropped or that is
 * mistyped still leaves the others showing. Only when every gauge fails does
 * the refresh fail, so the widget keeps its last good readings.
 */
export async function fetchRivers(gauges: string[], fetcher: typeof fetch = fetch, now = new Date()): Promise<RiverSnapshot> {
  const results = await Promise.allSettled(gauges.map((gauge) => fetchGauge(gauge, fetcher, now)));
  const snapshot: RiverSnapshot = { gauges: [], failed: [] };
  results.forEach((result, i) => {
    if (result.status === "fulfilled") snapshot.gauges.push(result.value);
    else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      snapshot.failed.push({ gauge: gauges[i]!.toUpperCase(), message });
    }
  });
  if (snapshot.gauges.length === 0 && snapshot.failed.length > 0) {
    throw new Error(snapshot.failed.map((f) => f.message).join("; "));
  }
  return snapshot;
}
