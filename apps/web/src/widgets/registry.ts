import { BinDayWidget } from "./BinDayWidget.js";
import { CalendarWidget } from "./CalendarWidget.js";
import { ClockWidget } from "./ClockWidget.js";
import { CommuteWidget } from "./CommuteWidget.js";
import { CountdownsWidget } from "./CountdownsWidget.js";
import { CpuWidget } from "./CpuWidget.js";
import { DisksWidget } from "./DisksWidget.js";
import { LightsWidget } from "./LightsWidget.js";
import { NetworkWidget } from "./NetworkWidget.js";
import { RiverWidget } from "./RiverWidget.js";
import { ServicesWidget } from "./ServicesWidget.js";
import { SpotifyWidget } from "./SpotifyWidget.js";
import { SunMoonWidget } from "./SunMoonWidget.js";
import { TasksWidget } from "./TasksWidget.js";
import { TempsWidget } from "./TempsWidget.js";
import { WeatherWidget } from "./WeatherWidget.js";
import type { WidgetDefinition } from "./types.js";

/** The host stats widgets all read one source, which only exists on Linux. */
const SYSTEM_HINT = "Reads the Linux server it runs on; see README: Homelab monitoring.";

/**
 * Every widget the dashboard knows how to draw.
 *
 * Adding one is a new file plus an entry here - nothing else in the client
 * changes, and the server only needs a matching source in its own registry if
 * the widget reads remote data.
 */
export const widgetRegistry: Record<string, WidgetDefinition> = {
  clock: {
    type: "clock",
    component: ClockWidget as WidgetDefinition["component"],
    chrome: true,
  },
  weather: {
    type: "weather",
    component: WeatherWidget as WidgetDefinition["component"],
    dataKey: "weather",
    chrome: true,
  },
  calendar: {
    type: "calendar",
    component: CalendarWidget as WidgetDefinition["component"],
    dataKey: "calendar",
    chrome: true,
  },
  tasks: {
    type: "tasks",
    component: TasksWidget as WidgetDefinition["component"],
    dataKey: "tasks",
    chrome: true,
  },
  lights: {
    type: "lights",
    component: LightsWidget as WidgetDefinition["component"],
    dataKey: "lights",
    chrome: true,
  },
  sunmoon: {
    type: "sunmoon",
    component: SunMoonWidget as WidgetDefinition["component"],
    chrome: true,
  },
  bins: {
    type: "bins",
    component: BinDayWidget as WidgetDefinition["component"],
    chrome: true,
  },
  countdowns: {
    type: "countdowns",
    component: CountdownsWidget as WidgetDefinition["component"],
    dataKey: "countdowns",
    chrome: true,
  },
  river: {
    type: "river",
    component: RiverWidget as WidgetDefinition["component"],
    dataKey: "river",
    chrome: true,
  },
  commute: {
    type: "commute",
    component: CommuteWidget as WidgetDefinition["component"],
    dataKey: "commute",
    chrome: true,
    setupHint: "Add TOMTOM_API_KEY to .env and your destinations under commute: in config.yaml.",
  },
  spotify: {
    type: "spotify",
    component: SpotifyWidget as WidgetDefinition["component"],
    dataKey: "spotify",
    chrome: true,
    setupHint: "Add SPOTIFY_CLIENT_ID to .env, then choose Connect Spotify in Settings.",
  },
  cpu: {
    type: "cpu",
    component: CpuWidget as WidgetDefinition["component"],
    dataKey: "system",
    chrome: true,
    setupHint: SYSTEM_HINT,
  },
  temps: {
    type: "temps",
    component: TempsWidget as WidgetDefinition["component"],
    dataKey: "system",
    chrome: true,
    setupHint: SYSTEM_HINT,
  },
  disks: {
    type: "disks",
    component: DisksWidget as WidgetDefinition["component"],
    dataKey: "system",
    chrome: true,
    setupHint: SYSTEM_HINT,
  },
  network: {
    type: "network",
    component: NetworkWidget as WidgetDefinition["component"],
    dataKey: "system",
    chrome: true,
    setupHint: SYSTEM_HINT,
  },
  services: {
    type: "services",
    component: ServicesWidget as WidgetDefinition["component"],
    dataKey: "services",
    chrome: true,
    setupHint: "Mount the Docker socket (see README: Homelab monitoring) or add URLs under services.checks in config.yaml.",
  },
};

export function widgetFor(type: string): WidgetDefinition | undefined {
  return widgetRegistry[type];
}
