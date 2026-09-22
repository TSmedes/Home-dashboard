import { describe, expect, it } from "vitest";
import {
  DashboardConfigSchema,
  type ConfigChange,
  type DashboardConfig,
  type PathSegment,
  type WidgetInstance,
} from "@home-dash/shared";
import { configChanges } from "./diff.js";
import { addWidget, placeWidget, removeWidget, reorder, swapBlocks } from "./mutations.js";

const config = (profiles: Record<string, unknown>, rest: Record<string, unknown> = {}): DashboardConfig =>
  DashboardConfigSchema.parse({
    location: { name: "Snoqualmie", lat: 47.5287, lon: -121.8254, timezone: "America/Los_Angeles" },
    units: { temperature: "fahrenheit", wind: "mph", clock: "12h" },
    profiles,
    ...rest,
  });

const day = {
  schedule: { from: "06:30", to: "21:30" },
  theme: "light",
  widgets: [
    { id: "clock", type: "clock", grid: { col: 1, row: 1, colSpan: 4, rowSpan: 2 } },
    { id: "weather", type: "weather", grid: { col: 5, row: 1, colSpan: 8, rowSpan: 2 } },
    { id: "agenda", type: "calendar", grid: { col: 1, row: 3, colSpan: 5, rowSpan: 4 }, options: { days: 3 } },
    { id: "todo", type: "tasks", grid: { col: 6, row: 3, colSpan: 4, rowSpan: 4 } },
    { id: "lights", type: "lights", grid: { col: 10, row: 3, colSpan: 3, rowSpan: 4 } },
  ],
};

const base = config({ day });

/** The widgets of a profile, as a fresh mutable list. */
const widgetsOf = (c: DashboardConfig, name = "day") => c.profiles[name]!.widgets;

/** A config with `day`'s widget list replaced. */
const withWidgets = (c: DashboardConfig, widgets: WidgetInstance[]): DashboardConfig => ({
  ...c,
  profiles: { ...c.profiles, day: { ...c.profiles.day!, widgets } },
});

// --- the server's own semantics, so the round trip means something ----------

/** ConfigStore.patch resolves every `{ id }` against the config before the patch. */
function resolvePath(root: unknown, path: PathSegment[]): (string | number)[] {
  const out: (string | number)[] = [];
  let node: unknown = root;
  for (const segment of path) {
    if (typeof segment === "object") {
      const index = (node as { id?: unknown }[]).findIndex((item) => item?.id === segment.id);
      if (index === -1) throw new Error(`nothing with id "${segment.id}" at ${out.join(".")}`);
      out.push(index);
      node = (node as unknown[])[index];
    } else {
      out.push(segment);
      node = (node as Record<string | number, unknown> | undefined)?.[segment];
    }
  }
  return out;
}

/**
 * Apply changes the way the server does: paths resolved once against the
 * original, then applied in turn to a document changing under them. Reparsing
 * at the end is the server revalidating, and puts the defaults back that the
 * changes deliberately left out.
 */
function applyLikeServer(from: DashboardConfig, changes: ConfigChange[]): DashboardConfig {
  const out = structuredClone(from) as Record<string, unknown>;
  const resolved = changes.map((change) => ({ ...change, path: resolvePath(from, change.path) }));

  for (const { path, value, op } of resolved) {
    let node: Record<string | number, unknown> = out;
    for (const segment of path.slice(0, -1)) {
      if (node[segment] === undefined) node[segment] = {};
      node = node[segment] as Record<string | number, unknown>;
    }
    const key = path.at(-1)!;
    if (Array.isArray(node) && typeof key === "number") {
      if (op === "insert") node.splice(key, 0, value);
      else if (value === null) node.splice(key, 1);
      else node.splice(key, 1, value);
    } else if (value === null) {
      delete node[key];
    } else {
      node[key] = value;
    }
  }

  return DashboardConfigSchema.parse(out);
}

/** Every scenario has to survive the trip there and back. */
const roundTrips = (next: DashboardConfig, from = base) => {
  const changes = configChanges(from, next);
  expect(applyLikeServer(from, changes)).toEqual(next);
  return changes;
};

const scalar = (value: unknown) =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

describe("configChanges round trip", () => {
  it("says nothing when nothing changed", () => {
    expect(configChanges(base, base)).toEqual([]);
  });

  it("moves a widget", () => {
    roundTrips(withWidgets(base, placeWidget(widgetsOf(base), "clock", { col: 5, row: 3, colSpan: 4, rowSpan: 2 })));
  });

  it("resizes a widget", () => {
    roundTrips(withWidgets(base, placeWidget(widgetsOf(base), "clock", { col: 1, row: 1, colSpan: 1, rowSpan: 1 })));
  });

  it("swaps two widgets", () => {
    roundTrips(withWidgets(base, swapBlocks(widgetsOf(base), 1, "agenda", "todo")));
  });

  it("adds a widget", () => {
    roundTrips(withWidgets(base, addWidget(widgetsOf(base), "river", 1)));
  });

  it("removes a widget", () => {
    roundTrips(withWidgets(base, removeWidget(widgetsOf(base), "agenda")));
  });

  it("removes several widgets at once", () => {
    const fewer = removeWidget(removeWidget(widgetsOf(base), "clock"), "todo");
    roundTrips(withWidgets(base, fewer));
  });

  it("adds and removes in the same save", () => {
    roundTrips(withWidgets(base, addWidget(removeWidget(widgetsOf(base), "clock"), "river", 1)));
  });

  it("reorders the list", () => {
    const band = widgetsOf(config({ day: { ...day, widgets: [
      { id: "clock", type: "clock", grid: { col: 1, row: 1, colSpan: 12, rowSpan: 4 } },
      { id: "a", type: "weather", grid: { row: 5, rowSpan: 2, share: true } },
      { id: "b", type: "calendar", grid: { row: 5, rowSpan: 2, share: true } },
      { id: "c", type: "tasks", grid: { row: 5, rowSpan: 2, share: true } },
    ] } }));
    const from = withWidgets(base, band);
    roundTrips(withWidgets(from, reorder(band, "c", -1)), from);
  });

  it("moves a widget to the front of the list", () => {
    const list = widgetsOf(base);
    const moved = [list[4]!, ...list.slice(0, 4)];
    roundTrips(withWidgets(base, moved));
  });

  it("sets an option", () => {
    const next = widgetsOf(base).map((w) => (w.id === "agenda" ? { ...w, options: { days: 5 } } : w));
    roundTrips(withWidgets(base, next));
  });

  it("puts an option back to its default", () => {
    const next = widgetsOf(base).map((w) => (w.id === "agenda" ? { ...w, options: {} } : w));
    roundTrips(withWidgets(base, next));
  });

  it("gives a widget an option it never had", () => {
    const next = widgetsOf(base).map((w) => (w.id === "clock" ? { ...w, options: { showSeconds: true } } : w));
    roundTrips(withWidgets(base, next));
  });

  it("switches a widget off", () => {
    const next = widgetsOf(base).map((w) => (w.id === "lights" ? { ...w, enabled: false } : w));
    roundTrips(withWidgets(base, next));
  });

  it("sends a widget to another page", () => {
    const next = widgetsOf(base).map((w) => (w.id === "lights" ? { ...w, page: 2 } : w));
    roundTrips(withWidgets(base, next));
  });

  it("puts a widget into a band, losing its column", () => {
    const next = widgetsOf(base).map((w) =>
      w.id === "lights" ? { ...w, grid: { row: 3, rowSpan: 4, colSpan: 3, share: true } } : w,
    );
    roundTrips(withWidgets(base, next as WidgetInstance[]));
  });

  it("adds a profile", () => {
    roundTrips(config({ day, night: { schedule: { from: "21:30", to: "06:30" }, theme: "dark", widgets: [
      { id: "clock", type: "clock", grid: { col: 1, row: 1, colSpan: 12, rowSpan: 6 } },
    ] } }));
  });

  it("deletes a profile", () => {
    const two = config({ day, night: { schedule: { from: "21:30", to: "06:30" }, theme: "dark", widgets: [
      { id: "clock", type: "clock", grid: { col: 1, row: 1, colSpan: 12, rowSpan: 6 } },
    ] } });
    roundTrips(config({ day }), two);
  });

  it("changes a profile's schedule and theme", () => {
    roundTrips(config({ day: { ...day, schedule: { from: "07:00", to: "22:00" }, theme: "dark" } }));
  });

  it("edits a list with no ids to address, like the countdowns", () => {
    const from = config({ day }, { countdowns: { items: [{ name: "Christmas", date: "2026-12-25" }] } });
    const next = config({ day }, { countdowns: { items: [
      { name: "Christmas", date: "2026-12-25", emoji: "🎄" },
      { name: "Holiday", date: "2026-07-14" },
    ] } });
    roundTrips(next, from);
  });

  it("edits a list that does have ids, like the lights", () => {
    const from = config({ day }, { lights: [
      { id: "lamp", name: "Lamp", host: "10.0.0.5" },
      { id: "hall", name: "Hall", host: "10.0.0.6" },
    ] });
    const next = config({ day }, { lights: [{ id: "hall", name: "Hallway", host: "10.0.0.6" }] });
    roundTrips(next, from);
  });

  it("changes a setting outside the profiles", () => {
    roundTrips(config({ day }, { units: { temperature: "celsius", wind: "kmh", clock: "24h" } }));
  });
});

describe("the shape of what it emits", () => {
  it("writes only plain values for a pure layout change, so the file is edited in place", () => {
    // If any value here were an object or a list, editText would give up and
    // the whole file would be re-printed.
    const moved = placeWidget(widgetsOf(base), "clock", { col: 5, row: 3, colSpan: 6, rowSpan: 1 });
    const changes = configChanges(base, withWidgets(base, moved));
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) expect(scalar(change.value), JSON.stringify(change.path)).toBe(true);
  });

  it("addresses a widget by id, not by where it happens to sit", () => {
    const moved = placeWidget(widgetsOf(base), "lights", { col: 1, row: 7, colSpan: 3, rowSpan: 2 });
    const changes = configChanges(base, withWidgets(base, moved));
    expect(changes[0]!.path).toEqual(["profiles", "day", "widgets", { id: "lights" }, "grid", "col"]);
  });

  it("sends a size back at its default as null, leaving no trace in the file", () => {
    const shrunk = placeWidget(widgetsOf(base), "clock", { col: 1, row: 1, colSpan: 1, rowSpan: 1 });
    const changes = configChanges(base, withWidgets(base, shrunk));
    const spans = changes.filter((c) => ["colSpan", "rowSpan"].includes(c.path.at(-1) as string));
    expect(spans).toHaveLength(2);
    for (const change of spans) expect(change.value).toBe(null);
  });

  it("leaves defaults out of a widget it writes in whole", () => {
    const changes = configChanges(base, withWidgets(base, addWidget(widgetsOf(base), "river", 1)));
    const added = changes.find((c) => c.op === "insert")!;
    expect(added.value).toEqual({ id: "river", type: "river", grid: { col: 1, row: 7, colSpan: 4, rowSpan: 2 } });
  });

  it("removes from the end backwards, so earlier positions stay valid", () => {
    const fewer = removeWidget(removeWidget(widgetsOf(base), "clock"), "agenda");
    const removals = configChanges(base, withWidgets(base, fewer)).filter((c) => c.value === null && c.op === undefined);
    expect(removals.map((c) => c.path.at(-1))).toEqual([2, 0]);
  });

  it("removes before it inserts", () => {
    const changes = configChanges(base, withWidgets(base, addWidget(removeWidget(widgetsOf(base), "clock"), "river", 1)));
    const removals = changes.map((c, i) => (c.value === null && c.op === undefined ? i : -1));
    const lastRemoval = Math.max(...removals);
    const firstInsert = changes.findIndex((c) => c.op === "insert");
    expect(lastRemoval).toBeLessThan(firstInsert);
  });

  it("re-lays out a whole page well inside one request", () => {
    let widgets = widgetsOf(base);
    for (const [i, w] of widgets.entries()) {
      widgets = placeWidget(widgets, w.id, { col: 1, row: i * 2 + 1, colSpan: 12, rowSpan: 2 });
    }
    // The server takes 200 changes in one save; a full page must not come close.
    expect(configChanges(base, withWidgets(base, widgets)).length).toBeLessThan(50);
  });
});
