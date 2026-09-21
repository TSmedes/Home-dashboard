import { describe, expect, it } from "vitest";
import { DashboardConfigSchema } from "./config.js";

/** Smallest config that should be considered valid. */
const minimal = {
  location: { name: "Snoqualmie, WA", lat: 47.5287, lon: -121.8254, timezone: "America/Los_Angeles" },
  units: { temperature: "fahrenheit", wind: "mph", clock: "12h" },
  profiles: {
    day: {
      schedule: { from: "06:30", to: "21:30" },
      theme: "light",
      widgets: [{ id: "clock", type: "clock", grid: { col: 1, row: 1, colSpan: 4, rowSpan: 2 } }],
    },
  },
};

const parse = (input: unknown) => DashboardConfigSchema.safeParse(input);

describe("DashboardConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const result = parse(minimal);
    expect(result.success).toBe(true);
  });

  it("applies defaults for omitted optional sections", () => {
    const result = DashboardConfigSchema.parse(minimal);
    expect(result.server.port).toBe(8080);
    expect(result.profiles.day!.widgets[0]!.options).toEqual({});
    expect(result.lights).toEqual([]);
  });

  it("defaults grid spans to 1 when omitted", () => {
    const result = DashboardConfigSchema.parse({
      ...minimal,
      profiles: {
        day: { ...minimal.profiles.day, widgets: [{ id: "clock", type: "clock", grid: { col: 1, row: 1 } }] },
      },
    });
    expect(result.profiles.day!.widgets[0]!.grid.colSpan).toBe(1);
    expect(result.profiles.day!.widgets[0]!.grid.rowSpan).toBe(1);
  });

  it("rejects a widget that overflows the 12-column grid", () => {
    const result = parse({
      ...minimal,
      profiles: {
        day: { ...minimal.profiles.day, widgets: [{ id: "wide", type: "clock", grid: { col: 10, row: 1, colSpan: 4 } }] },
      },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/12-column/);
  });

  it("rejects duplicate widget ids within a profile", () => {
    const result = parse({
      ...minimal,
      profiles: {
        day: {
          ...minimal.profiles.day,
          widgets: [
            { id: "dupe", type: "clock", grid: { col: 1, row: 1 } },
            { id: "dupe", type: "weather", grid: { col: 2, row: 1 } },
          ],
        },
      },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/duplicate/i);
  });

  it.each(["6:30", "25:00", "06:60", "0630", "half past six"])(
    "rejects malformed schedule time %s",
    (from) => {
      const result = parse({
        ...minimal,
        profiles: { day: { ...minimal.profiles.day, schedule: { from, to: "21:30" } } },
      });
      expect(result.success).toBe(false);
    },
  );

  it("requires at least one profile", () => {
    expect(parse({ ...minimal, profiles: {} }).success).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    expect(parse({ ...minimal, location: { ...minimal.location, lat: 91 } }).success).toBe(false);
    expect(parse({ ...minimal, location: { ...minimal.location, lon: -181 } }).success).toBe(false);
  });

  it("accepts a night profile whose window crosses midnight", () => {
    const result = parse({
      ...minimal,
      profiles: {
        ...minimal.profiles,
        night: {
          schedule: { from: "21:30", to: "06:30" },
          theme: "dark",
          widgets: [{ id: "clock", type: "clock", grid: { col: 1, row: 1, colSpan: 12, rowSpan: 4 } }],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("treats every widget as enabled and every bulb as shown unless told otherwise", () => {
    const result = DashboardConfigSchema.parse({
      ...minimal,
      lights: [{ id: "front", name: "Front", host: "10.0.0.147" }],
    });
    expect(result.profiles.day!.widgets[0]!.enabled).toBe(true);
    expect(result.lights[0]!.hidden).toBe(false);
  });

  it("accepts a switched-off widget and a hidden bulb", () => {
    const result = DashboardConfigSchema.parse({
      ...minimal,
      lights: [{ id: "front", name: "Front", host: "10.0.0.147", hidden: true }],
      profiles: {
        day: {
          ...minimal.profiles.day,
          widgets: [{ id: "clock", type: "clock", enabled: false, grid: { col: 1, row: 1 } }],
        },
      },
    });
    expect(result.profiles.day!.widgets[0]!.enabled).toBe(false);
    expect(result.lights[0]!.hidden).toBe(true);
  });

  // A shared row places widgets by order, so they need no column.
  it("accepts a shared-row widget without a column", () => {
    const result = DashboardConfigSchema.parse({
      ...minimal,
      profiles: {
        day: { ...minimal.profiles.day, widgets: [{ id: "w", type: "weather", grid: { row: 5, rowSpan: 2, share: true } }] },
      },
    });
    expect(result.profiles.day!.widgets[0]!.grid).toMatchObject({ row: 5, rowSpan: 2, share: true });
  });

  it("still requires a column for a widget that is not shared", () => {
    const result = parse({
      ...minimal,
      profiles: { day: { ...minimal.profiles.day, widgets: [{ id: "w", type: "weather", grid: { row: 1 } }] } },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/col is required unless share/);
  });

  it("rejects an unknown theme", () => {
    const result = parse({
      ...minimal,
      profiles: { day: { ...minimal.profiles.day, theme: "sepia" } },
    });
    expect(result.success).toBe(false);
  });
});
