import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigStore, formatConfigError } from "./loader.js";

const YAML_WITH_COMMENTS = `# Home dashboard configuration.
# Edited by hand or by the settings UI - comments below must survive both.
location:
  name: "Snoqualmie, WA" # where the weather comes from
  lat: 47.5287
  lon: -121.8254
  timezone: "America/Los_Angeles"

units:
  temperature: fahrenheit
  wind: mph
  clock: 12h

server:
  port: 8080 # change this if 8080 is taken on your server

profiles:
  # The daytime dashboard.
  day:
    schedule: { from: "06:30", to: "21:30" }
    theme: light
    widgets:
      - id: clock
        type: clock
        grid: { col: 1, row: 1, colSpan: 4, rowSpan: 2 }
`;

const dirs: string[] = [];
async function tempConfig(contents = YAML_WITH_COMMENTS) {
  const dir = await mkdtemp(join(tmpdir(), "home-dash-cfg-"));
  dirs.push(dir);
  const path = join(dir, "config.yaml");
  await writeFile(path, contents, "utf8");
  return path;
}

afterEach(() => { dirs.length = 0; });

describe("ConfigStore", () => {
  it("loads and validates a config file", async () => {
    const store = await ConfigStore.open(await tempConfig());
    expect(store.current.location.name).toBe("Snoqualmie, WA");
    expect(store.current.server.port).toBe(8080);
    expect(store.current.profiles.day!.widgets).toHaveLength(1);
  });

  it("rejects an invalid config with a message naming the offending field", async () => {
    const path = await tempConfig(YAML_WITH_COMMENTS.replace("lat: 47.5287", "lat: 910"));
    await expect(ConfigStore.open(path)).rejects.toThrow(/location\.lat/);
  });

  it("rejects malformed YAML rather than starting with half a config", async () => {
    const path = await tempConfig("location: {{{ broken");
    await expect(ConfigStore.open(path)).rejects.toThrow();
  });

  it("preserves comments on untouched keys when the settings UI saves", async () => {
    const path = await tempConfig();
    const store = await ConfigStore.open(path);

    await store.replace({ ...store.current, server: { port: 9090 } });

    const written = await readFile(path, "utf8");
    expect(written).toContain("# Home dashboard configuration.");
    expect(written).toContain("# where the weather comes from");
    expect(written).toContain("# The daytime dashboard.");
    expect(written).toContain("port: 9090");
    expect(written).not.toContain("port: 8080");
  });

  it("preserves the trailing comment on a key whose value changed", async () => {
    const path = await tempConfig();
    const store = await ConfigStore.open(path);

    await store.replace({ ...store.current, server: { port: 9090 } });

    const written = await readFile(path, "utf8");
    expect(written).toMatch(/port: 9090 # change this if 8080 is taken/);
  });

  it("applies structural additions, such as a new profile", async () => {
    const path = await tempConfig();
    const store = await ConfigStore.open(path);

    await store.replace({
      ...store.current,
      profiles: {
        ...store.current.profiles,
        night: {
          schedule: { from: "21:30", to: "06:30" },
          theme: "dark" as const,
          widgets: [{ id: "clock", type: "clock", grid: { col: 1, row: 1, colSpan: 12, rowSpan: 4 }, options: {} }],
        },
      },
    });

    const reopened = await ConfigStore.open(path);
    expect(Object.keys(reopened.current.profiles)).toEqual(["day", "night"]);
    expect(reopened.current.profiles.night!.theme).toBe("dark");
    expect(await readFile(path, "utf8")).toContain("# The daytime dashboard.");
  });

  it("removes keys that the new config drops", async () => {
    const path = await tempConfig();
    const store = await ConfigStore.open(path);
    const next = structuredClone(store.current) as Record<string, unknown>;
    (next.location as Record<string, unknown>).name = "Fall City, WA";

    await store.replace(next);
    expect(await readFile(path, "utf8")).toContain("Fall City, WA");
  });

  it("refuses an invalid update and leaves the file byte-identical", async () => {
    const path = await tempConfig();
    const store = await ConfigStore.open(path);
    const before = await readFile(path, "utf8");

    await expect(
      store.replace({ ...store.current, units: { ...store.current.units, clock: "13h" } }),
    ).rejects.toThrow();

    expect(await readFile(path, "utf8")).toBe(before);
    expect(store.current.units.clock).toBe("12h"); // in-memory state untouched too
  });

  it("reloads from disk when the file changes underneath it", async () => {
    const path = await tempConfig();
    const store = await ConfigStore.open(path);
    await writeFile(path, YAML_WITH_COMMENTS.replace("port: 8080", "port: 7070"), "utf8");

    const reloaded = await store.reload();
    expect(reloaded.server.port).toBe(7070);
    expect(store.current.server.port).toBe(7070);
  });

  it("keeps the last good config when a hand edit breaks the file", async () => {
    const path = await tempConfig();
    const store = await ConfigStore.open(path);
    await writeFile(path, "location: {{{ broken", "utf8");

    await expect(store.reload()).rejects.toThrow();
    // A typo in an SSH session must not take the wall display down.
    expect(store.current.server.port).toBe(8080);
  });
});

// What the settings screen saves through. It must touch only the line that
// changed: never reformat the file, never drop a comment, never write defaults.
const RICH_YAML = `# Hand-written config.
location:
  name: "Snoqualmie, WA" # where the weather comes from
  lat: 47.5287
  lon: -121.8254
  timezone: "America/Los_Angeles"

units:
  temperature: fahrenheit
  wind: mph
  clock: 12h

lights:
  - { id: front-door, name: "Front door light", host: 10.0.0.147 }
  - { id: back-patio, name: "Back patio light", host: 10.0.0.237 }

profiles:
  day:
    schedule: { from: "06:30", to: "21:30" }
    theme: light
    widgets:
      - id: clock
        type: clock
        grid: { col: 1, row: 1, colSpan: 4, rowSpan: 2 }
      # The agenda sits under the clock.
      - id: agenda
        type: calendar
        grid: { col: 1, row: 3, colSpan: 5, rowSpan: 4 }
  night:
    schedule: { from: "21:30", to: "06:30" }
    theme: dark
    widgets:
      - id: clock
        type: clock
        grid: { col: 1, row: 1, colSpan: 12, rowSpan: 4 }
`;

describe("ConfigStore.patch", () => {
  it("changes one value and leaves every other byte of the file alone", async () => {
    const path = await tempConfig(RICH_YAML);
    const store = await ConfigStore.open(path);

    await store.patch([{ path: ["units", "clock"], value: "24h" }]);

    expect(await readFile(path, "utf8")).toBe(RICH_YAML.replace("clock: 12h", "clock: 24h"));
    expect(store.current.units.clock).toBe("24h");
  });

  it("never writes defaults into the file", async () => {
    const path = await tempConfig(RICH_YAML);
    const store = await ConfigStore.open(path);

    await store.patch([{ path: ["units", "temperature"], value: "celsius" }]);

    const written = await readFile(path, "utf8");
    for (const noise of ["options:", "enabled:", "hidden:", "refresh:", "server:", "daysAhead"]) {
      expect(written).not.toContain(noise);
    }
  });

  it("addresses a widget by id, so a reordered file cannot misdirect a save", async () => {
    const path = await tempConfig(RICH_YAML);
    const store = await ConfigStore.open(path);

    await store.patch([{ path: ["profiles", "day", "widgets", { id: "agenda" }, "enabled"], value: false }]);

    expect(store.current.profiles.day!.widgets.find((w) => w.id === "agenda")!.enabled).toBe(false);
    expect(store.current.profiles.day!.widgets.find((w) => w.id === "clock")!.enabled).toBe(true);
    expect(await readFile(path, "utf8")).toContain("# The agenda sits under the clock.");
  });

  it("edits a bulb inside a one-line entry without rewriting its neighbours", async () => {
    const path = await tempConfig(RICH_YAML);
    const store = await ConfigStore.open(path);

    await store.patch([
      { path: ["lights", { id: "back-patio" }, "name"], value: "Patio" },
      { path: ["lights", { id: "back-patio" }, "hidden"], value: true },
    ]);

    const written = await readFile(path, "utf8");
    expect(written).toContain('- { id: front-door, name: "Front door light", host: 10.0.0.147 }');
    expect(written).toMatch(/id: back-patio, name: "Patio", host: 10\.0\.0\.237, hidden: true/);
  });

  // Switching a widget off and on again must not leave `enabled: true` behind.
  it("removes a key when the change's value is null, restoring the file exactly", async () => {
    const path = await tempConfig(RICH_YAML);
    const store = await ConfigStore.open(path);
    const target = ["profiles", "day", "widgets", { id: "agenda" }, "enabled"];

    await store.patch([{ path: target, value: false }]);
    await store.patch([{ path: target, value: null }]);

    expect(await readFile(path, "utf8")).toBe(RICH_YAML);
    expect(store.current.profiles.day!.widgets.find((w) => w.id === "agenda")!.enabled).toBe(true);
  });

  // The real config aligns its trailing comments into columns. The YAML
  // library re-spaces those when it re-prints a file, so a save used to
  // disturb lines nowhere near the edit.
  it("keeps hand-aligned comment columns, even on lines far from the edit", async () => {
    const aligned = RICH_YAML.replace(
      "units:\n  temperature: fahrenheit\n  wind: mph\n  clock: 12h",
      "units:\n  temperature: fahrenheit # fahrenheit | celsius\n  wind: mph               # mph | kmh\n  clock: 12h              # 12h | 24h",
    );
    const path = await tempConfig(aligned);
    const store = await ConfigStore.open(path);

    await store.patch([{ path: ["profiles", "day", "widgets", { id: "agenda" }, "enabled"], value: false }]);
    await store.patch([{ path: ["units", "clock"], value: "24h" }]);

    const written = await readFile(path, "utf8");
    expect(written).toContain("  wind: mph               # mph | kmh");
    expect(written).toContain("  clock: 24h              # 12h | 24h");
    expect(written).toContain("        enabled: false\n");
  });

  it("still saves a change it cannot make as a small text edit", async () => {
    const path = await tempConfig(RICH_YAML);
    const store = await ConfigStore.open(path);

    await store.patch([{ path: ["calendar"], value: { daysAhead: 3 } }]);

    expect(store.current.calendar.daysAhead).toBe(3);
    expect(await readFile(path, "utf8")).toContain("# Hand-written config.");
  });

  it("applies several changes as one save", async () => {
    const path = await tempConfig(RICH_YAML);
    const store = await ConfigStore.open(path);

    await store.patch([
      { path: ["location", "name"], value: "Fall City, WA" },
      { path: ["location", "lat"], value: 47.5673 },
      { path: ["location", "lon"], value: -121.8887 },
    ]);

    expect(store.current.location).toMatchObject({ name: "Fall City, WA", lat: 47.5673, lon: -121.8887 });
    expect(await readFile(path, "utf8")).toContain("# where the weather comes from");
  });

  it("refuses a change that would make the config invalid, leaving the file untouched", async () => {
    const path = await tempConfig(RICH_YAML);
    const store = await ConfigStore.open(path);

    await expect(
      store.patch([{ path: ["profiles", "day", "schedule", "from"], value: "25:00" }]),
    ).rejects.toThrow(/profiles\.day\.schedule\.from/);
    expect(await readFile(path, "utf8")).toBe(RICH_YAML);
  });

  it("refuses to touch an item that does not exist", async () => {
    const path = await tempConfig(RICH_YAML);
    const store = await ConfigStore.open(path);

    await expect(store.patch([{ path: ["lights", { id: "kitchen" }, "hidden"], value: true }])).rejects.toThrow(
      /kitchen/,
    );
    expect(await readFile(path, "utf8")).toBe(RICH_YAML);
  });

  // A hand edit over SSH moments before a tap on the iPad must survive the save.
  it("patches the file as it is on disk now, not a stale copy", async () => {
    const path = await tempConfig(RICH_YAML);
    const store = await ConfigStore.open(path);
    await writeFile(path, RICH_YAML.replace('name: "Snoqualmie, WA"', 'name: "Edited by hand"'), "utf8");

    await store.patch([{ path: ["units", "clock"], value: "24h" }]);

    const written = await readFile(path, "utf8");
    expect(written).toContain("Edited by hand");
    expect(written).toContain("clock: 24h");
  });
});

/**
 * The file a fresh install starts from, and the one whose comments explain the
 * dashboard to whoever opens it next.
 */
const examplePath = fileURLToPath(new URL("../../../../config/config.example.yaml", import.meta.url));
const hashes = (text: string) => (text.match(/#/g) ?? []).length;

/**
 * Edit mode can rewrite the layout from the wall, which makes config.yaml the
 * one file the dashboard edits on the owner's behalf. These tests exist to
 * notice the day it starts eating their notes: writing the widget list back as
 * one value costs sixteen of the example's comments, and nothing else in the
 * suite would have failed.
 */
describe("ConfigStore.patch on the shipped example", () => {
  it("keeps every comment when a page is re-laid-out", async () => {
    const source = await readFile(examplePath, "utf8");
    const path = await tempConfig(source);
    const store = await ConfigStore.open(path);

    // What dragging two tiles and resizing one saves.
    await store.patch([
      { path: ["profiles", "day", "widgets", { id: "clock" }, "grid", "col"], value: 5 },
      { path: ["profiles", "day", "widgets", { id: "weather" }, "grid", "col"], value: 1 },
      { path: ["profiles", "day", "widgets", { id: "agenda" }, "grid", "colSpan"], value: 6 },
    ]);

    const written = await readFile(path, "utf8");
    expect(hashes(written)).toBe(hashes(source));
  });

  it("touches only the lines it edits", async () => {
    const source = await readFile(examplePath, "utf8");
    const path = await tempConfig(source);
    const store = await ConfigStore.open(path);

    await store.patch([{ path: ["profiles", "day", "widgets", { id: "clock" }, "grid", "col"], value: 5 }]);

    const written = await readFile(path, "utf8");
    const before = source.split("\n");
    const after = written.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before.filter((line, i) => line !== after[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("col: 1");
    expect(written).toContain("grid: { col: 5, row: 1, colSpan: 4, rowSpan: 2 }");
  });

  it("keeps every comment when a widget is added and another removed", async () => {
    const source = await readFile(examplePath, "utf8");
    const path = await tempConfig(source);
    const store = await ConfigStore.open(path);
    const before = store.current.profiles.day!.widgets;
    const dropped = before.findIndex((w) => w.id === "lights");

    await store.patch([
      { path: ["profiles", "day", "widgets", dropped], value: null },
      {
        path: ["profiles", "day", "widgets", before.length - 1],
        value: { id: "river-2", type: "river", grid: { col: 1, row: 7, colSpan: 4, rowSpan: 2 } },
        op: "insert",
      },
    ]);

    const written = await readFile(path, "utf8");
    const ids = store.current.profiles.day!.widgets.map((w) => w.id);
    expect(ids).toContain("river-2");
    expect(ids).not.toContain("lights");
    // The only notes lost are the ones that were explaining the lights widget.
    const notes = (text: string) =>
      text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("#"));
    const kept = new Set(notes(written));
    const lost = notes(source).filter((line) => !kept.has(line));
    expect(lost.join(" ")).toContain("lights has the column to itself");
    expect(lost).toHaveLength(2);
  });

  it("writes a new widget the same way even when the save falls back to reprinting", async () => {
    // A list written back whole - the countdowns - cannot be a text edit, and
    // the whole batch reprints. Which edits happened to share a save must not
    // decide whether a widget gets an inline grid or five lines of block map.
    const source = await readFile(examplePath, "utf8");
    const path = await tempConfig(source);
    const store = await ConfigStore.open(path);
    const count = store.current.profiles.day!.widgets.length;

    await store.patch([
      { path: ["countdowns", "items"], value: [{ name: "Holiday", date: "2026-07-14" }] },
      {
        path: ["profiles", "day", "widgets", count],
        value: { id: "river-2", type: "river", grid: { col: 1, row: 7, colSpan: 4, rowSpan: 2 } },
        op: "insert",
      },
    ]);

    const written = await readFile(path, "utf8");
    expect(written).toContain("grid: { col: 1, row: 7, colSpan: 4, rowSpan: 2 }");
    expect(written).toContain("- id: river-2");
    expect(hashes(written)).toBe(hashes(source));
  });

  it("writes a new widget's grid inline, the way the file writes every other one", async () => {
    const source = await readFile(examplePath, "utf8");
    const path = await tempConfig(source);
    const store = await ConfigStore.open(path);
    const count = store.current.profiles.day!.widgets.length;

    await store.patch([
      {
        path: ["profiles", "day", "widgets", count],
        value: { id: "river-2", type: "river", grid: { col: 1, row: 7, colSpan: 4, rowSpan: 2 } },
        op: "insert",
      },
    ]);

    const written = await readFile(path, "utf8");
    expect(written).toContain("grid: { col: 1, row: 7, colSpan: 4, rowSpan: 2 }");
  });
});

describe("formatConfigError", () => {
  it("renders zod issues as readable dotted paths", () => {
    const message = formatConfigError([
      { path: ["location", "lat"], message: "Number must be less than or equal to 90" },
      { path: ["profiles", "day", "theme"], message: "Invalid enum value" },
    ] as never);
    expect(message).toContain("location.lat");
    expect(message).toContain("profiles.day.theme");
  });
});
