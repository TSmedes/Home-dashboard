import { describe, expect, it } from "vitest";
import type { WidgetInstance } from "@home-dash/shared";
import { groupWidgets, layout } from "./layout.js";

const widget = (id: string, grid: Partial<WidgetInstance["grid"]>, enabled = true): WidgetInstance => ({
  id,
  type: id,
  enabled,
  page: 1,
  options: {},
  grid: { row: 1, colSpan: 1, rowSpan: 1, share: false, ...grid },
});

// The night screen: a big clock, then a shared bottom row.
const night = [
  widget("clock", { col: 1, row: 1, colSpan: 12, rowSpan: 4 }),
  widget("weather", { row: 5, rowSpan: 2, share: true }),
  widget("agenda", { row: 5, rowSpan: 2, share: true }),
  widget("todo", { row: 5, rowSpan: 2, share: true }, false),
  widget("lights", { row: 5, rowSpan: 2, share: true }, false),
];

const shape = (widgets: WidgetInstance[], showing?: (w: WidgetInstance) => boolean) =>
  layout(widgets, showing).cells.map((cell) => (cell.kind === "widget" ? cell.widget.id : cell.widgets.map((w) => w.id)));

// The right-hand column of the day screen: lights above, bin day below.
const column = [
  widget("lights", { col: 10, row: 9, colSpan: 3, rowSpan: 7, stack: "right" }),
  widget("bins", { col: 10, row: 16, colSpan: 3, rowSpan: 9, stack: "right" }),
];

describe("layout", () => {
  it("places a fixed widget by its column and row", () => {
    const [cell] = layout([widget("clock", { col: 2, row: 3, colSpan: 4, rowSpan: 2 })]).cells;
    expect(cell).toMatchObject({ kind: "widget", column: "2 / span 4", row: "3 / span 2" });
  });

  it("gathers shared widgets on the same rows into one row, in the order written", () => {
    expect(shape(night)).toEqual(["clock", ["weather", "agenda"]]);
  });

  // The point of sharing: switching one on widens the row, with no gap.
  it("includes a shared widget as soon as it is switched on", () => {
    const withLights = night.map((w) => (w.id === "lights" ? { ...w, enabled: true } : w));
    expect(shape(withLights)).toEqual(["clock", ["weather", "agenda", "lights"]]);
  });

  it("spans the shared row across the full width of its rows", () => {
    const band = layout(night).cells[1];
    expect(band).toMatchObject({ kind: "band", row: "5 / span 2" });
  });

  it("drops a shared row entirely when everything in it is switched off", () => {
    const allOff = night.map((w) => (w.grid.share ? { ...w, enabled: false } : w));
    expect(shape(allOff)).toEqual(["clock"]);
  });

  it("keeps separate shared rows separate", () => {
    const widgets = [
      widget("a", { row: 1, share: true }),
      widget("b", { row: 1, share: true }),
      widget("c", { row: 2, share: true }),
    ];
    expect(shape(widgets)).toEqual([["a", "b"], ["c"]]);
  });

  // Rows come from every widget, on or off, so switching things off never
  // makes the remaining ones grow taller.
  it("counts rows from every widget, including switched-off ones", () => {
    expect(layout(night).rows).toBe(6);
    const widgets = [widget("a", { col: 1, row: 1 }), widget("b", { col: 1, row: 4, rowSpan: 2 }, false)];
    expect(layout(widgets).rows).toBe(5);
  });

  it("leaves out a switched-off fixed widget", () => {
    expect(shape([widget("a", { col: 1 }), widget("b", { col: 2 }, false)])).toEqual(["a"]);
  });

  // A widget can be hidden for a reason of its own - bin day, most of the week -
  // rather than because it was switched off in settings.
  it("takes a widget the predicate hides out of the layout", () => {
    const widgets = [widget("a", { col: 1 }), widget("b", { col: 2 })];
    expect(shape(widgets, (w) => w.id !== "b")).toEqual(["a"]);
  });

  it("counts rows from a hidden widget too, so nothing grows taller", () => {
    const widgets = [widget("a", { col: 1, row: 1 }), widget("b", { col: 1, row: 4, rowSpan: 2 })];
    expect(layout(widgets, (w) => w.id !== "b").rows).toBe(5);
  });
});

describe("layout stacks", () => {
  it("gathers a stack into one cell spanning every member's rows", () => {
    const [cell] = layout(column).cells;
    expect(cell).toMatchObject({ kind: "stack", column: "10 / span 3", row: "9 / span 16" });
  });

  it("splits the stack between its members, in the order written", () => {
    expect(shape(column)).toEqual([["lights", "bins"]]);
  });

  // The point of a stack: the space a hidden member leaves goes to the rest.
  it("keeps the whole rectangle when a member is hidden", () => {
    const [cell] = layout(column, (w) => w.id !== "bins").cells;
    expect(cell).toMatchObject({ kind: "stack", row: "9 / span 16" });
    expect(shape(column, (w) => w.id !== "bins")).toEqual([["lights"]]);
  });

  it("drops the stack entirely when every member is hidden", () => {
    expect(shape(column, () => false)).toEqual([]);
  });

  it("keeps stacks with different names apart", () => {
    const widgets = [
      widget("a", { col: 1, row: 1, stack: "left" }),
      widget("b", { col: 10, row: 1, stack: "right" }),
      widget("c", { col: 1, row: 2, stack: "left" }),
    ];
    expect(shape(widgets)).toEqual([["a", "c"], ["b"]]);
  });

  it("counts a hidden member's rows towards the stack's rectangle", () => {
    // Without bins the union would stop at row 15; it must still reach 24.
    const [cell] = layout(column, (w) => w.id === "lights").cells;
    expect(cell).toMatchObject({ row: "9 / span 16" });
  });
});

describe("groupWidgets", () => {
  it("keeps every member, showing or not, unlike layout", () => {
    const [clock, band] = groupWidgets(night);
    expect(clock).toMatchObject({ kind: "widget", key: "clock" });
    // layout() drops the two switched-off widgets; a group keeps all four.
    expect(band).toMatchObject({ kind: "band", members: [{ id: "weather" }, { id: "agenda" }, { id: "todo" }, { id: "lights" }] });
  });

  it("takes a group's place from its first member", () => {
    const widgets = [
      widget("a", { col: 1, row: 1 }),
      widget("b", { row: 2, share: true }),
      widget("c", { col: 1, row: 3 }),
      widget("d", { row: 2, share: true }),
    ];
    expect(groupWidgets(widgets).map((g) => g.key)).toEqual(["a", "band 2 / span 1", "c"]);
  });

  it("shares a row only with widgets covering the same rows", () => {
    // Starting on row 2 is not enough: a taller neighbour is its own band.
    const widgets = [
      widget("short", { row: 2, share: true }),
      widget("tall", { row: 2, rowSpan: 3, share: true }),
    ];
    expect(groupWidgets(widgets).map((g) => g.members.map((w) => w.id))).toEqual([["short"], ["tall"]]);
  });

  it("treats a widget naming a stack as a stack member even if it also shares", () => {
    // The two are mutually exclusive and the editor never writes both, but
    // layout has always read `stack` first, so grouping must agree.
    const widgets = [widget("a", { col: 1, row: 1, stack: "right", share: true })];
    expect(groupWidgets(widgets)[0]).toMatchObject({ kind: "stack", name: "right" });
  });

  it("gathers a stack under its name", () => {
    expect(groupWidgets(column)).toEqual([
      { kind: "stack", key: "stack right", name: "right", members: column },
    ]);
  });
});
