import { fetchCalendars, parseFeedUrls, windowFor } from "./calendar/ical.js";
import { fetchCommute } from "./commute/tomtom.js";
import { fetchCountdowns } from "./countdowns/index.js";
import { createLightsAdapter } from "./lights/index.js";
import { riverGaugesFor } from "@home-dash/shared";
import { fetchRivers } from "./river/nwps.js";
import { SpotifyClient, TOKEN_KEY } from "./spotify/client.js";
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
  {
    // Polls every gauge that any river widget, on any profile, shows.
    key: "river",
    create: ({ config }) => {
      const gauges = new Set<string>();
      for (const profile of Object.values(config.profiles)) {
        for (const widget of profile.widgets) {
          if (widget.type !== "river") continue;
          for (const gauge of riverGaugesFor(widget.options, config.river.gauges)) gauges.add(gauge);
        }
      }
      if (gauges.size === 0) return null;
      return {
        key: "river",
        intervalMs: config.refresh.river * 1000,
        fetch: () => fetchRivers([...gauges]),
      };
    },
  },
  {
    // Always on: dates written in config.yaml need no account. Calendar events
    // tagged as countdowns join in when there are calendars to read.
    key: "countdowns",
    create: ({ config, env }) => {
      const urls = parseFeedUrls(env.CALENDAR_ICAL_URLS);
      return {
        key: "countdowns",
        intervalMs: config.refresh.countdowns * 1000,
        fetch: () => fetchCountdowns(config, urls),
      };
    },
  },
  {
    key: "commute",
    create: ({ config, env }) => {
      if (!env.TOMTOM_API_KEY || config.commute.destinations.length === 0) return null;
      const key = env.TOMTOM_API_KEY;
      return {
        key: "commute",
        intervalMs: config.refresh.commute * 1000,
        fetch: () => fetchCommute(config.location, config.commute.destinations, key),
      };
    },
  },
  {
    // Needs both the app's client id and a finished sign-in from settings.
    key: "spotify",
    create: ({ config, env, tokens }) => {
      if (!env.SPOTIFY_CLIENT_ID || !tokens.has(TOKEN_KEY)) return null;
      const client = new SpotifyClient({ clientId: env.SPOTIFY_CLIENT_ID, vault: tokens });
      return {
        key: "spotify",
        intervalMs: config.refresh.spotify * 1000,
        fetch: () => client.read(),
      };
    },
  },
];

export * from "./types.js";
