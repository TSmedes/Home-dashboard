import { existsSync } from "node:fs";
import { join } from "node:path";
import { fetchCalendars, parseFeedUrls, windowFor } from "./calendar/ical.js";
import { fetchCommute } from "./commute/tomtom.js";
import { fetchCountdowns } from "./countdowns/index.js";
import { createLightsAdapter } from "./lights/index.js";
import { riverGaugesFor } from "@home-dash/shared";
import { createPihole } from "./pihole/index.js";
import { fetchRivers } from "./river/nwps.js";
import { fetchServices } from "./services/index.js";
import { socketRequest } from "./services/docker.js";
import { SpotifyClient, TOKEN_KEY } from "./spotify/client.js";
import { createHostReader } from "./system/host.js";
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
    create: ({ config, env }) => {
      const adapter = createLightsAdapter(config, env);
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
  {
    // The machine the dashboard runs on. Only Linux has /proc; anywhere else
    // (the Windows dev PC) the monitoring widgets say where they work instead.
    key: "system",
    create: ({ config, env }) => {
      if (!existsSync(join(env.HOST_PROC, "stat"))) return null;
      const reader = createHostReader({ root: env.HOST_ROOT, proc: env.HOST_PROC, sys: env.HOST_SYS }, config.system);
      return {
        key: "system",
        intervalMs: config.refresh.system * 1000,
        fetch: () => reader.read(),
      };
    },
  },
  {
    // Docker containers and URL checks. With no socket and nothing to check,
    // there is nothing to show; a missing socket alongside checks is reported
    // in the widget, since in Docker it usually means a forgotten mount.
    key: "services",
    create: ({ config, env }) => {
      const { docker, checks } = config.services;
      const socket = docker.enabled && (checks.length > 0 || existsSync(env.DOCKER_SOCKET));
      if (!socket && checks.length === 0) return null;
      const request = socket ? socketRequest(env.DOCKER_SOCKET) : null;
      return {
        key: "services",
        intervalMs: config.refresh.services * 1000,
        fetch: () => fetchServices(config.services, request),
      };
    },
  },
  {
    // Pi-hole running anywhere on the network, the homelab host included.
    key: "pihole",
    create: ({ config, env }) => {
      if (!config.pihole.url || !env.PIHOLE_PASSWORD) return null;
      const pihole = createPihole({ url: config.pihole.url, password: env.PIHOLE_PASSWORD });
      return {
        key: "pihole",
        intervalMs: config.refresh.pihole * 1000,
        fetch: () => pihole.read(config.location.timezone),
      };
    },
  },
];

export * from "./types.js";
