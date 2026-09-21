import { CalendarWidget } from "./CalendarWidget.js";
import { ClockWidget } from "./ClockWidget.js";
import { LightsWidget } from "./LightsWidget.js";
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
    chrome: false,
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
};

export function widgetFor(type: string): WidgetDefinition | undefined {
  return widgetRegistry[type];
}
