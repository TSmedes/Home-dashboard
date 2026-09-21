import { describe, expect, it, vi } from "vitest";
import { DashboardConfigSchema, type DashboardConfig } from "@home-dash/shared";
import { MemoryCacheStore, PollingCache } from "./cache/PollingCache.js";
import type { ConfigStore } from "./config/loader.js";
import { Dashboard } from "./dashboard.js";
import { openDatabase, StateStore, TokenStore } from "./db/index.js";
import type { Env } from "./env.js";
import type { SourceFactory } from "./providers/index.js";
import type { StreamHub } from "./stream.js";

const baseConfig = (): DashboardConfig =>
  DashboardConfigSchema.parse({
    location: { name: "Snoqualmie, WA", lat: 47.5287, lon: -121.8254, timezone: "America/Los_Angeles" },
    units: { temperature: "fahrenheit", wind: "mph", clock: "12h" },
    lights: [{ id: "front", name: "Front door", host: "10.0.0.147" }],
    profiles: {
      day: {
        schedule: { from: "06:30", to: "21:30" },
        theme: "light",
        widgets: [{ id: "clock", type: "clock", grid: { col: 1, row: 1 } }],
      },
      night: {
        schedule: { from: "21:30", to: "06:30" },
        theme: "dark",
        widgets: [{ id: "clock", type: "clock", grid: { col: 1, row: 1 } }],
      },
    },
  });

// Stand-ins for the real providers, reading the same settings they do.
const factories: SourceFactory[] = [
  {
    key: "weather",
    create: ({ config }) => ({
      key: "weather",
      intervalMs: 60_000,
      fetch: async () => `weather for ${config.location.name}`,
    }),
  },
  {
    key: "lights",
    create: ({ config }) =>
      config.lights.length === 0
        ? null
        : { key: "lights", intervalMs: 60_000, fetch: async () => config.lights.map((l) => l.host) },
  },
];

function setup(extra: SourceFactory[] = [], db = openDatabase(":memory:")) {
  const store = { current: baseConfig() };
  const hub = { broadcast: vi.fn() };
  const cache = new PollingCache({ store: new MemoryCacheStore() });
  // Monday 21 September 2026, noon in Los Angeles. Tests move it along.
  const clock = { now: new Date("2026-09-21T19:00:00Z") };
  const dashboard = new Dashboard({
    configStore: store as unknown as ConfigStore,
    cache,
    tokens: new TokenStore(db),
    state: new StateStore(db),
    hub: hub as unknown as StreamHub,
    env: {} as Env,
    factories: [...factories, ...extra],
    now: () => clock.now,
  });
  return { store, hub, cache, dashboard, clock, db };
}

describe("Dashboard: manual profile override", () => {
  it("switches straight away and says until when", () => {
    const { dashboard, hub } = setup();
    expect(dashboard.activeProfile).toBe("day");

    const override = dashboard.setOverride("night");

    expect(dashboard.activeProfile).toBe("night");
    expect(override).toEqual({ profile: "night", until: "2026-09-22T04:30:00.000Z" }); // 21:30 tonight
    expect(hub.broadcast).toHaveBeenCalledWith({ type: "profile-changed", profile: "night", override });
  });

  // Forced day at 11pm: stays day through the night, and the schedule has
  // taken over again by morning without anyone switching it back.
  it("lasts until the next scheduled switch, then clears itself", () => {
    const { dashboard, clock } = setup();
    clock.now = new Date("2026-09-22T06:00:00Z"); // 23:00
    dashboard.checkProfile();
    expect(dashboard.activeProfile).toBe("night");

    dashboard.setOverride("day");
    clock.now = new Date("2026-09-22T13:29:00Z"); // 06:29
    dashboard.checkProfile();
    expect(dashboard.activeProfile).toBe("day");
    expect(dashboard.override).not.toBeNull();

    clock.now = new Date("2026-09-22T13:31:00Z"); // 06:31
    dashboard.checkProfile();
    expect(dashboard.activeProfile).toBe("day");
    expect(dashboard.override).toBeNull();
  });

  it("does not stay forced after the schedule has moved on", () => {
    const { dashboard, clock } = setup();
    dashboard.setOverride("night"); // at noon, until 21:30
    clock.now = new Date("2026-09-22T13:31:00Z"); // next morning, 06:31
    dashboard.checkProfile();
    expect(dashboard.activeProfile).toBe("day");
  });

  it("goes back to the schedule on request", () => {
    const { dashboard, hub } = setup();
    dashboard.setOverride("night");
    hub.broadcast.mockClear();

    dashboard.clearOverride();

    expect(dashboard.activeProfile).toBe("day");
    expect(dashboard.override).toBeNull();
    expect(hub.broadcast).toHaveBeenCalledWith({ type: "profile-changed", profile: "day", override: null });
  });

  it("refuses a profile that does not exist", () => {
    const { dashboard } = setup();
    expect(() => dashboard.setOverride("party")).toThrow(/party/);
  });

  it("survives a server restart", () => {
    const db = openDatabase(":memory:");
    setup([], db).dashboard.setOverride("night");
    const restarted = setup([], db).dashboard;
    expect(restarted.activeProfile).toBe("night");
  });

  it("is dropped if its profile is removed from config.yaml", () => {
    const { dashboard, store } = setup();
    dashboard.setOverride("night");
    const { night: _removed, ...rest } = store.current.profiles;
    store.current = { ...store.current, profiles: rest };
    dashboard.onConfigChanged();
    expect(dashboard.activeProfile).toBe("day");
    expect(dashboard.override).toBeNull();
  });
});

describe("Dashboard: live config reload", () => {
  // The defect this guards: sources captured their settings at start-up, so
  // editing config.yaml changed the layout but not the data until a restart.
  it("uses the new settings on the next fetch after config.yaml changes", async () => {
    const { store, cache, dashboard } = setup();
    expect((await cache.refresh("weather")).data).toBe("weather for Snoqualmie, WA");

    store.current = { ...store.current, location: { ...store.current.location, name: "Fall City, WA" } };
    dashboard.onConfigChanged();

    expect((await cache.refresh("weather")).data).toBe("weather for Fall City, WA");
  });

  it("picks up a changed bulb address", async () => {
    const { store, cache, dashboard } = setup();
    store.current = { ...store.current, lights: [{ id: "front", name: "Front door", host: "10.0.0.200" }] };
    dashboard.onConfigChanged();
    expect((await cache.refresh("lights")).data).toEqual(["10.0.0.200"]);
  });

  it("stops a source whose settings were removed", () => {
    const { store, cache, dashboard } = setup();
    expect(dashboard.availableSources()).toContain("lights");

    store.current = { ...store.current, lights: [] };
    dashboard.onConfigChanged();

    expect(dashboard.availableSources()).not.toContain("lights");
    expect(cache.keys()).not.toContain("lights");
  });

  it("starts a source that has just been configured", () => {
    const { store, dashboard } = setup();
    store.current = { ...store.current, lights: [] };
    dashboard.onConfigChanged();

    store.current = { ...store.current, lights: [{ id: "back", name: "Back", host: "10.0.0.148" }] };
    dashboard.onConfigChanged();
    expect(dashboard.availableSources()).toContain("lights");
  });

  it("keeps the previous source if a factory fails on the new config", async () => {
    let fail = false;
    const { cache, dashboard } = setup([
      {
        key: "flaky",
        create: () => {
          if (fail) throw new Error("bad setting");
          return { key: "flaky", intervalMs: 60_000, fetch: async () => "still here" };
        },
      },
    ]);
    fail = true;
    dashboard.onConfigChanged();

    expect(dashboard.availableSources()).toContain("flaky");
    expect((await cache.refresh("flaky")).data).toBe("still here");
  });

  it("tells connected screens the config changed", () => {
    const { hub, dashboard } = setup();
    dashboard.onConfigChanged();
    expect(hub.broadcast).toHaveBeenCalledWith({ type: "config-changed" });
  });
});
