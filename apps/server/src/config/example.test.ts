import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DashboardConfigSchema, riverGaugesFor } from "@home-dash/shared";

const examplePath = fileURLToPath(new URL("../../../../config/config.example.yaml", import.meta.url));

/**
 * The example is what a fresh install starts from, so it must always load -
 * and it is where every new widget is shown off, so it is worth checking it
 * still does what its comments say.
 */
describe("config.example.yaml", async () => {
  const config = DashboardConfigSchema.parse(parse(await readFile(examplePath, "utf8")));

  it("is valid", () => {
    expect(Object.keys(config.profiles)).toEqual(["day", "night"]);
  });

  it("puts the new widgets on a second day page and leaves night on one", () => {
    const pages = (profile: string) => new Set(config.profiles[profile]!.widgets.map((w) => w.page));
    expect([...pages("day")]).toEqual([1, 2]);
    expect([...pages("night")]).toEqual([1]);
    const second = config.profiles.day!.widgets.filter((w) => w.page === 2).map((w) => w.type);
    expect(second).toEqual(["river", "sunmoon", "bins", "countdowns", "commute", "spotify"]);
  });

  it("keeps each page inside the grid", () => {
    for (const widget of config.profiles.day!.widgets) {
      expect(widget.grid.row + widget.grid.rowSpan - 1, widget.id).toBeLessThanOrEqual(6);
    }
  });
});

describe("new config sections", () => {
  const base = parse(`
location: { name: X, lat: 0, lon: 0, timezone: UTC }
units: { temperature: celsius, wind: kmh, clock: 24h }
profiles:
  day:
    schedule: { from: "06:00", to: "22:00" }
    theme: light
    widgets: []
`) as Record<string, unknown>;

  it("defaults everything, so older configs still load", () => {
    const config = DashboardConfigSchema.parse(base);
    expect(config.bins).toEqual([]);
    expect(config.river.gauges).toEqual(["SQUW1"]);
    expect(config.commute.destinations).toEqual([]);
    expect(config.countdowns.calendarTag).toBe("#countdown");
    expect(config.profiles.day!.returnToFirstPage).toBe(120);
  });

  it("needs an anchor for a bin that is not collected weekly", () => {
    const result = DashboardConfigSchema.safeParse({ ...base, bins: [{ name: "Recycling", day: "tue", every: 2 }] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("anchor is required");
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    const result = DashboardConfigSchema.safeParse({ ...base, countdowns: { items: [{ name: "X", date: "31/10/2026" }] } });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate commute destinations", () => {
    const place = { id: "a", name: "A", lat: 1, lon: 1 };
    const result = DashboardConfigSchema.safeParse({ ...base, commute: { destinations: [place, place] } });
    expect(result.success).toBe(false);
  });
});

describe("riverGaugesFor", () => {
  it("uses the widget's own gauges, upper-cased and without repeats", () => {
    expect(riverGaugesFor({ gauges: ["snqw1", "TANW1", "SNQW1"] }, ["SQUW1"])).toEqual(["SNQW1", "TANW1"]);
  });

  it("falls back to the config-wide list when the widget names none or names nonsense", () => {
    expect(riverGaugesFor({}, ["SQUW1"])).toEqual(["SQUW1"]);
    expect(riverGaugesFor({ gauges: [] }, ["SQUW1"])).toEqual(["SQUW1"]);
    expect(riverGaugesFor({ gauges: "SNQW1" }, ["SQUW1"])).toEqual(["SQUW1"]);
  });
});
