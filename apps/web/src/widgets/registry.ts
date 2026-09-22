import { BinDayWidget } from "./BinDayWidget.js";
import { CalendarWidget } from "./CalendarWidget.js";
import { ClockWidget } from "./ClockWidget.js";
import { CommuteWidget } from "./CommuteWidget.js";
import { CountdownsWidget } from "./CountdownsWidget.js";
import { LightsWidget } from "./LightsWidget.js";
import { RiverWidget } from "./RiverWidget.js";
import { SpotifyWidget } from "./SpotifyWidget.js";
import { SunMoonWidget } from "./SunMoonWidget.js";
import { TasksWidget } from "./TasksWidget.js";
import { WeatherWidget } from "./WeatherWidget.js";
import type { WidgetDefinition } from "./types.js";

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
};

export function widgetFor(type: string): WidgetDefinition | undefined {
  return widgetRegistry[type];
}
