import { fetchCalendars, parseFeedUrls, windowFor } from "./calendar/ical.js";
import { createLightsAdapter } from "./lights/index.js";
import { createTickTick } from "./tasks/index.js";
import { fetchWeather } from "./weather/openMeteo.js";
import type { SourceFactory } from "./types.js";

/**
 * Every pollable data source, in one list.
 *
 * Adding an integration means adding a factory here and a widget component on
 * the client - nothing else in the server changes. The source key doubles as
 * the widget type, which is how a widget finds its data.
 *
 * Returning null means "not configured", which is different from failing: the
 * widget shows a setup prompt instead of retrying a doomed request forever.
 */
export const sourceFactories: SourceFactory[] = [
  {
    key: "weather",
    create: ({ config }) => ({
      key: "weather",
      intervalMs: config.refresh.weather * 1000,
      fetch: () => fetchWeather(config.location, config.units),
    }),
  },
  {
    key: "calendar",
    create: ({ config, env }) => {
      const urls = parseFeedUrls(env.CALENDAR_ICAL_URLS);
      if (urls.length === 0) return null;
      return {
        key: "calendar",
        intervalMs: config.refresh.calendar * 1000,
        // The window is recomputed on every fetch, so it rolls over at midnight.
        fetch: () =>
          fetchCalendars(urls, windowFor(new Date(), config.calendar.daysAhead, config.location.timezone)),
      };
    },
  },
  {
    key: "tasks",
    create: ({ config, env }) => {
      const tasks = createTickTick(config, env);
      if (!tasks) return null;
      return {
        key: "tasks",
        intervalMs: config.refresh.tasks * 1000,
        fetch: () => tasks.read(),
      };
    },
  },
  {
    key: "lights",
    create: ({ config }) => {
      const adapter = createLightsAdapter(config);
      if (!adapter) return null;
      return {
        key: "lights",
        intervalMs: config.refresh.lights * 1000,
        fetch: () => adapter.read(),
      };
    },
  },
];

export * from "./types.js";
