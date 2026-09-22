import SunCalc from "suncalc";
import { addDays, dateKey } from "../lib/zoned.js";

export interface SunDay {
  sunrise: Date | null;
  sunset: Date | null;
  /** Seconds of daylight; null when the sun does not both rise and set. */
  dayLength: number | null;
  /** Today's daylight minus yesterday's, in seconds. */
  change: number | null;
}

export type MoonPhaseName =
  | "New moon"
  | "Waxing crescent"
  | "First quarter"
  | "Waxing gibbous"
  | "Full moon"
  | "Waning gibbous"
  | "Last quarter"
  | "Waning crescent";

export interface MoonNow {
  /** 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  phase: number;
  /** Lit fraction of the disc, 0-1. */
  illumination: number;
  name: MoonPhaseName;
  /** The next full or new moon, whichever comes first. */
  next: { kind: "Full moon" | "New moon"; at: Date };
}

const valid = (d: Date) => (Number.isFinite(d.getTime()) ? d : null);

/**
 * Sun times for a local calendar date. Noon UTC is the same calendar day in
 * every zone from UTC-11 to UTC+11, which is what SunCalc needs to pick the
 * right solar day.
 */
function sunFor(key: string, lat: number, lon: number) {
  const times = SunCalc.getTimes(new Date(`${key}T12:00:00Z`), lat, lon);
  const sunrise = valid(times.sunrise);
  const sunset = valid(times.sunset);
  return { sunrise, sunset, dayLength: sunrise && sunset ? (sunset.getTime() - sunrise.getTime()) / 1000 : null };
}

export function sunToday(now: Date, lat: number, lon: number, timezone: string): SunDay {
  const today = dateKey(now, timezone);
  const current = sunFor(today, lat, lon);
  const yesterday = sunFor(addDays(today, -1), lat, lon);
  return {
    ...current,
    change: current.dayLength !== null && yesterday.dayLength !== null ? current.dayLength - yesterday.dayLength : null,
  };
}

/** The quarters are instants; a day either side reads as the named phase. */
const QUARTER_WINDOW = 0.034;

export function phaseName(phase: number): MoonPhaseName {
  const near = (target: number) => Math.min(Math.abs(phase - target), 1 - Math.abs(phase - target)) < QUARTER_WINDOW;
  if (near(0)) return "New moon";
  if (near(0.25)) return "First quarter";
  if (near(0.5)) return "Full moon";
  if (near(0.75)) return "Last quarter";
  if (phase < 0.25) return "Waxing crescent";
  if (phase < 0.5) return "Waxing gibbous";
  if (phase < 0.75) return "Waning gibbous";
  return "Waning crescent";
}

const HOUR = 3_600_000;

/**
 * When the phase next crosses full (0.5) or new (wrapping 1 to 0). Stepped
 * hourly, which is finer than anything the widget shows.
 */
export function nextFullOrNew(from: Date): MoonNow["next"] {
  let previous = SunCalc.getMoonIllumination(from).phase;
  for (let t = from.getTime() + HOUR; t <= from.getTime() + 31 * 24 * HOUR; t += HOUR) {
    const phase = SunCalc.getMoonIllumination(new Date(t)).phase;
    if (previous < 0.5 && phase >= 0.5) return { kind: "Full moon", at: new Date(t) };
    if (phase < previous - 0.5) return { kind: "New moon", at: new Date(t) };
    previous = phase;
  }
  return { kind: "New moon", at: new Date(from.getTime() + 29.5 * 24 * HOUR) };
}

export function moonNow(now: Date): MoonNow {
  const { phase, fraction } = SunCalc.getMoonIllumination(now);
  return { phase, illumination: fraction, name: phaseName(phase), next: nextFullOrNew(now) };
}

/** "12h 04m". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** "+2m 41s" or "−3m 05s": how today's daylight compares with yesterday's. */
export function formatChange(seconds: number): string {
  const sign = seconds < 0 ? "−" : "+";
  const total = Math.round(Math.abs(seconds));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return m > 0 ? `${sign}${m}m ${s}s` : `${sign}${total}s`;
}

/**
 * The lit part of the disc as an SVG path, for a northern-hemisphere sky:
 * waxing is lit on the right. The outer edge is a half circle; the
 * terminator is a half ellipse whose width follows the phase.
 */
export function moonPath(phase: number, cx: number, cy: number, r: number): string {
  const rx = Math.abs(Math.cos(2 * Math.PI * phase)) * r;
  const waxing = phase < 0.5;
  const crescent = phase < 0.25 || phase > 0.75;
  const outerSweep = waxing ? 1 : 0;
  const innerSweep = waxing ? (crescent ? 0 : 1) : crescent ? 1 : 0;
  const f = (n: number) => Number(n.toFixed(2));
  return [
    `M ${f(cx)} ${f(cy - r)}`,
    `A ${f(r)} ${f(r)} 0 0 ${outerSweep} ${f(cx)} ${f(cy + r)}`,
    `A ${f(rx)} ${f(r)} 0 0 ${innerSweep} ${f(cx)} ${f(cy - r)}`,
    "Z",
  ].join(" ");
}

export interface SunTimes {
  dawn: Date | null;
  sunrise: Date | null;
  solarNoon: Date | null;
  /** When the evening golden hour begins. */
  goldenHour: Date | null;
  sunset: Date | null;
  dusk: Date | null;
}

/** The day's sun from first light to last, for the expanded view. */
export function sunDetail(now: Date, lat: number, lon: number, timezone: string): SunTimes {
  const t = SunCalc.getTimes(new Date(`${dateKey(now, timezone)}T12:00:00Z`), lat, lon);
  return {
    dawn: valid(t.dawn),
    sunrise: valid(t.sunrise),
    solarNoon: valid(t.solarNoon),
    goldenHour: valid(t.goldenHour),
    sunset: valid(t.sunset),
    dusk: valid(t.dusk),
  };
}

const STEP = 5 * 60_000;
/** The altitude SunCalc treats as the moon's limb touching the horizon. */
const MOON_HORIZON = 0.133 * (Math.PI / 180);

/**
 * Moonrise and moonset in the 24 hours from `dayStart`. SunCalc's own
 * version starts the day at the machine's midnight, which is only right when
 * the iPad is set to the dashboard's timezone; this starts wherever it is
 * told to. Sampled every five minutes, then interpolated.
 */
export function moonRiseSet(dayStart: number, lat: number, lon: number): { rise: Date | null; set: Date | null } {
  const altitude = (t: number) => SunCalc.getMoonPosition(new Date(t), lat, lon).altitude - MOON_HORIZON;
  let rise: Date | null = null;
  let set: Date | null = null;
  let previous = altitude(dayStart);
  for (let t = dayStart + STEP; t <= dayStart + 24 * HOUR; t += STEP) {
    const current = altitude(t);
    const crossing = new Date(t - STEP + (previous / (previous - current)) * STEP);
    if (previous < 0 && current >= 0 && !rise) rise = crossing;
    if (previous >= 0 && current < 0 && !set) set = crossing;
    previous = current;
  }
  return { rise, set };
}

/** The next full moon and the next new moon, soonest first. */
export function nextPhases(from: Date): [MoonNow["next"], MoonNow["next"]] {
  const first = nextFullOrNew(from);
  // A day on, so the search does not find the same moment again.
  return [first, nextFullOrNew(new Date(first.at.getTime() + 24 * HOUR))];
}
