import type { FloodCategory, RiverPoint, RiverGauge } from "@home-dash/shared";

export const CATEGORY_LABEL: Record<FloodCategory, string> = {
  none: "Normal",
  action: "Near flood stage",
  minor: "Minor flooding",
  moderate: "Moderate flooding",
  major: "Major flooding",
};

const ORDER = ["action", "minor", "moderate", "major"] as const;

/**
 * A name short enough for a row: "North Fork" for a fork, otherwise the place
 * ("Snoqualmie Falls", "Carnation"). NOAA's names run long and sometimes
 * repeat themselves ("South Fork Snoqualmie River near South Fork ...").
 */
export function shortName(name: string): string {
  const fork = /^(North|Middle|South|East|West) Fork\b/i.exec(name);
  if (fork) return `${fork[1]} Fork`;
  const place = /\b(?:at|near|above|below)\s+(.+)$/i.exec(name);
  return (place?.[1] ?? name).trim();
}

/** "12,400 cfs" or "8.4 ft". */
export function formatLevel(value: number, unit: string): string {
  return unit === "ft" ? `${value.toFixed(1)} ft` : `${Math.round(value).toLocaleString("en-US")} ${unit}`;
}

/** The next threshold above the current level, to say how far off trouble is. */
export function nextThreshold(snapshot: RiverGauge): { category: (typeof ORDER)[number]; value: number } | null {
  const current = snapshot.current?.value ?? 0;
  for (const category of ORDER) {
    const value = snapshot.thresholds[category];
    if (value !== undefined && value > current) return { category, value };
  }
  return null;
}

/** Rising, falling or steady, ignoring wobble under 3% of the current level. */
export function trendOf(snapshot: RiverGauge): "rising" | "falling" | "steady" | null {
  if (snapshot.change6h === null || !snapshot.current) return null;
  const tolerance = Math.max(Math.abs(snapshot.current.value) * 0.03, snapshot.unit === "ft" ? 0.1 : 10);
  if (snapshot.change6h > tolerance) return "rising";
  if (snapshot.change6h < -tolerance) return "falling";
  return "steady";
}

export interface Sparkline {
  observed: string;
  forecast: string;
  /** A threshold line, only when the river is near enough for it to fit. */
  threshold: { y: number; label: string } | null;
}

/** How far ahead the chart looks; NOAA forecasts run to ten days, which would dwarf two days of readings. */
const FORECAST_SHOWN_MS = 72 * 3_600_000;

/**
 * Observed as a solid line, forecast dashed after it, on one time axis. The
 * axis starts at zero so a calm river looks calm. The action threshold is
 * drawn only when the river is within reach of it: otherwise a summer
 * trickle would be squashed flat against the floor.
 */
export function sparkline(snapshot: RiverGauge, width: number, height: number): Sparkline | null {
  const last = snapshot.observed.at(-1);
  const horizon = (last ? Date.parse(last.time) : Date.now()) + FORECAST_SHOWN_MS;
  const ahead = snapshot.forecast.filter((p) => Date.parse(p.time) <= horizon);
  const points = [...snapshot.observed, ...ahead];
  if (points.length < 2) return null;

  const times = points.map((p) => Date.parse(p.time));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const highest = Math.max(...points.map((p) => p.value));
  const first = ORDER.map((c) => snapshot.thresholds[c]).find((v) => v !== undefined);
  const showThreshold = first !== undefined && highest >= first * 0.5;
  const top = Math.max(highest * 1.25, showThreshold ? first * 1.08 : 0) || 1;
  const bottom = 0;

  const x = (p: RiverPoint) => ((Date.parse(p.time) - t0) / Math.max(t1 - t0, 1)) * width;
  const y = (v: number) => height - ((v - bottom) / Math.max(top - bottom, 1e-9)) * height;
  const line = (list: RiverPoint[]) =>
    list.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");

  // The forecast starts from the last observation so the two lines join.
  const forecast = ahead.length > 0 ? line(last ? [last, ...ahead] : ahead) : "";

  return {
    observed: line(snapshot.observed),
    forecast,
    threshold: showThreshold ? { y: y(first), label: formatLevel(first, snapshot.unit) } : null,
  };
}
