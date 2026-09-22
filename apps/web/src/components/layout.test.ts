import { describe, expect, it } from "vitest";
import type { WidgetInstance } from "@home-dash/shared";
import { layout } from "./layout.js";

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

const shape = (widgets: WidgetInstance[]) =>
  layout(widgets).cells.map((cell) => (cell.kind === "band" ? cell.widgets.map((w) => w.id) : cell.widget.id));

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
});
