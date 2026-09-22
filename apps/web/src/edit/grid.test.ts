import { describe, expect, it } from "vitest";
import type { WidgetInstance } from "@home-dash/shared";
import {
  blockAt,
  blocksOf,
  canPlace,
  clampResize,
  dropOutcome,
  findSwapTarget,
  freeRectFor,
  freeRunIn,
  overlaps,
  rowsOf,
  type Rect,
} from "./grid.js";

const widget = (id: string, grid: Partial<WidgetInstance["grid"]>, enabled = true): WidgetInstance => ({
  id,
  type: id,
  enabled,
  page: 1,
  options: {},
  grid: { row: 1, colSpan: 1, rowSpan: 1, share: false, ...grid },
});

/** Page 1 of the shipped day profile, which tiles the grid exactly. */
const day = [
  widget("clock", { col: 1, row: 1, colSpan: 4, rowSpan: 2 }),
  widget("weather", { col: 5, row: 1, colSpan: 8, rowSpan: 2 }),
  widget("agenda", { col: 1, row: 3, colSpan: 5, rowSpan: 4 }),
  widget("todo", { col: 6, row: 3, colSpan: 4, rowSpan: 4 }),
  widget("lights", { col: 10, row: 3, colSpan: 3, rowSpan: 4 }),
];

/** The night screen: a big clock over a shared bottom row, two of it switched off. */
const night = [
  widget("clock", { col: 1, row: 1, colSpan: 12, rowSpan: 4 }),
  widget("weather", { row: 5, rowSpan: 2, share: true }),
  widget("agenda", { row: 5, rowSpan: 2, share: true }),
  widget("todo", { row: 5, rowSpan: 2, share: true }, false),
];

/** A right-hand column shared by two widgets. */
const column = [
  widget("river", { col: 1, row: 1, colSpan: 9, rowSpan: 6 }),
  widget("lights", { col: 10, row: 1, colSpan: 3, rowSpan: 2, stack: "right" }),
  widget("bins", { col: 10, row: 3, colSpan: 3, rowSpan: 4, stack: "right" }),
];

const rect = (col: number, row: number, colSpan = 1, rowSpan = 1): Rect => ({ col, row, colSpan, rowSpan });

describe("blocksOf", () => {
  it("gives each fixed widget its own rectangle", () => {
    expect(blocksOf(day).map((b) => [b.key, b.rect])).toEqual([
      ["clock", rect(1, 1, 4, 2)],
      ["weather", rect(5, 1, 8, 2)],
      ["agenda", rect(1, 3, 5, 4)],
      ["todo", rect(6, 3, 4, 4)],
      ["lights", rect(10, 3, 3, 4)],
    ]);
  });

  it("gives a band the full width of the rows it shares", () => {
    const [, band] = blocksOf(night);
    expect(band!).toMatchObject({ kind: "band", rect: rect(1, 5, 12, 2) });
  });

  it("counts a switched-off band member, because its space is still claimed", () => {
    const [, band] = blocksOf(night);
    expect(band!.members.map((w) => w.id)).toEqual(["weather", "agenda", "todo"]);
  });

  it("gives a stack the union of every member, hidden or not", () => {
    const [, stack] = blocksOf(column);
    expect(stack!).toMatchObject({ kind: "stack", key: "stack right", rect: rect(10, 1, 3, 6) });
  });

  it("treats a widget with no col as column 1", () => {
    expect(blocksOf([widget("a", { row: 1 })])[0]!.rect).toEqual(rect(1, 1));
  });
});

describe("rowsOf", () => {
  it("counts the rows the page needs, matching layout()", () => {
    expect(rowsOf(day)).toBe(6);
    expect(rowsOf(night)).toBe(6);
  });

  it("counts a switched-off widget's rows, so its space stays reserved", () => {
    expect(rowsOf([widget("a", { col: 1, row: 1 }), widget("b", { col: 1, row: 8 }, false)])).toBe(8);
  });

  it("is at least one row, even with nothing on the page", () => {
    expect(rowsOf([])).toBe(1);
  });
});

describe("overlaps", () => {
  it("is false for rectangles that merely touch", () => {
    expect(overlaps(rect(1, 1, 4, 2), rect(5, 1, 8, 2))).toBe(false);
    expect(overlaps(rect(1, 1, 4, 2), rect(1, 3, 4, 2))).toBe(false);
  });

  it("is true when they share even one cell", () => {
    expect(overlaps(rect(1, 1, 4, 2), rect(4, 2, 4, 2))).toBe(true);
  });

  it("is true when one contains the other", () => {
    expect(overlaps(rect(1, 1, 12, 6), rect(5, 3, 2, 2))).toBe(true);
  });
});

describe("blockAt", () => {
  it("finds the block covering a cell", () => {
    expect(blockAt(blocksOf(day), 7, 4)?.key).toBe("todo");
  });

  it("finds a stack by any cell of its union", () => {
    expect(blockAt(blocksOf(column), 11, 5)?.key).toBe("stack right");
  });

  it("is null on empty space", () => {
    expect(blockAt(blocksOf([widget("a", { col: 1, row: 1 })]), 6, 3)).toBe(null);
  });
});

describe("canPlace", () => {
  const blocks = blocksOf(day);

  it("allows a widget back where it already is", () => {
    expect(canPlace(blocks, "clock", rect(1, 1, 4, 2))).toBe(true);
  });

  it("refuses space another widget holds", () => {
    expect(canPlace(blocks, "clock", rect(5, 1, 4, 2))).toBe(false);
  });

  it("refuses to hang off the right-hand edge", () => {
    expect(canPlace([], "a", rect(10, 1, 4, 1))).toBe(false);
    expect(canPlace([], "a", rect(9, 1, 4, 1))).toBe(true);
  });

  it("refuses a column or row before the first", () => {
    expect(canPlace([], "a", rect(0, 1))).toBe(false);
    expect(canPlace([], "a", rect(1, 0))).toBe(false);
  });
});

describe("findSwapTarget", () => {
  it("finds a single occupant of exactly the same size", () => {
    const blocks = blocksOf([
      widget("a", { col: 1, row: 1, colSpan: 6, rowSpan: 2 }),
      widget("b", { col: 7, row: 1, colSpan: 6, rowSpan: 2 }),
    ]);
    expect(findSwapTarget(blocks, "a", rect(7, 1, 6, 2))?.key).toBe("b");
  });

  it("refuses an occupant of a different size", () => {
    expect(findSwapTarget(blocksOf(day), "clock", rect(5, 1, 4, 2))).toBe(null);
  });

  it("refuses when the drop lands across two widgets at once", () => {
    // A 4x4 dropped at column 3 row 3 covers part of agenda and part of todo.
    expect(findSwapTarget(blocksOf(day), "clock", rect(3, 3, 4, 4))).toBe(null);
  });
});

describe("dropOutcome", () => {
  it("is free on empty space", () => {
    const blocks = blocksOf([widget("a", { col: 1, row: 1, colSpan: 4, rowSpan: 2 })]);
    expect(dropOutcome(blocks, "a", rect(5, 1, 4, 2))).toEqual({ kind: "free" });
  });

  it("swaps with a same-size neighbour", () => {
    const blocks = blocksOf([
      widget("a", { col: 1, row: 1, colSpan: 6, rowSpan: 2 }),
      widget("b", { col: 7, row: 1, colSpan: 6, rowSpan: 2 }),
    ]);
    expect(dropOutcome(blocks, "a", rect(7, 1, 6, 2))).toEqual({ kind: "swap", withKey: "b" });
  });

  it("blocks a different-size neighbour", () => {
    expect(dropOutcome(blocksOf(day), "clock", rect(5, 1, 4, 2))).toEqual({ kind: "blocked" });
  });

  it("blocks a drop that leaves the grid", () => {
    expect(dropOutcome([], "a", rect(11, 1, 4, 1))).toEqual({ kind: "blocked" });
  });
});

describe("clampResize", () => {
  const blocks = blocksOf(day);

  it("grows into free space", () => {
    const only = blocksOf([widget("a", { col: 1, row: 1, colSpan: 4, rowSpan: 2 })]);
    expect(clampResize(only, "a", rect(1, 1, 4, 2), { colSpan: 1 }, 6)).toEqual(rect(1, 1, 5, 2));
  });

  it("stops at the right-hand edge", () => {
    const only = blocksOf([widget("a", { col: 10, row: 1, colSpan: 3, rowSpan: 1 })]);
    expect(clampResize(only, "a", rect(10, 1, 3, 1), { colSpan: 4 }, 6)).toEqual(rect(10, 1, 3, 1));
  });

  it("stops at the last row of the page", () => {
    const only = blocksOf([widget("a", { col: 1, row: 5, colSpan: 4, rowSpan: 2 })]);
    expect(clampResize(only, "a", rect(1, 5, 4, 2), { rowSpan: 3 }, 6)).toEqual(rect(1, 5, 4, 2));
  });

  it("stops before a neighbour instead of overlapping it", () => {
    // clock is 4 wide at column 1; weather starts at column 5.
    expect(clampResize(blocks, "clock", rect(1, 1, 4, 2), { colSpan: 3 }, 6)).toEqual(rect(1, 1, 4, 2));
  });

  it("grows as far as it can when asked for more than fits", () => {
    const only = blocksOf([
      widget("a", { col: 1, row: 1, colSpan: 2, rowSpan: 1 }),
      widget("b", { col: 5, row: 1, colSpan: 2, rowSpan: 1 }),
    ]);
    expect(clampResize(only, "a", rect(1, 1, 2, 1), { colSpan: 9 }, 6)).toEqual(rect(1, 1, 4, 1));
  });

  it("shrinks freely but never below one cell", () => {
    expect(clampResize(blocks, "clock", rect(1, 1, 4, 2), { colSpan: -9 }, 6)).toEqual(rect(1, 1, 1, 2));
  });
});

describe("freeRectFor", () => {
  it("finds the first free rectangle, reading across then down", () => {
    const blocks = blocksOf([widget("a", { col: 1, row: 1, colSpan: 4, rowSpan: 2 })]);
    expect(freeRectFor(blocks, { colSpan: 4, rowSpan: 2 }, 6)).toEqual(rect(5, 1, 4, 2));
  });

  it("drops to a later row when nothing fits alongside", () => {
    const blocks = blocksOf([widget("a", { col: 1, row: 1, colSpan: 12, rowSpan: 2 })]);
    expect(freeRectFor(blocks, { colSpan: 4, rowSpan: 2 }, 6)).toEqual(rect(1, 3, 4, 2));
  });

  it("adds a row at the bottom when the page is full", () => {
    // The day page tiles all six rows exactly, so a new tile has to go below.
    expect(freeRectFor(blocksOf(day), { colSpan: 4, rowSpan: 2 }, 6)).toEqual(rect(1, 7, 4, 2));
  });
});

describe("freeRunIn", () => {
  it("finds the leftmost free column on those rows", () => {
    const blocks = blocksOf([widget("a", { col: 1, row: 1, colSpan: 4, rowSpan: 2 })]);
    expect(freeRunIn(blocks, 1, 2, 3)).toBe(5);
  });

  it("is null when the rows are full", () => {
    const blocks = blocksOf([widget("a", { col: 1, row: 1, colSpan: 12, rowSpan: 2 })]);
    expect(freeRunIn(blocks, 1, 2, 3)).toBe(null);
  });

  it("ignores the block the caller is placing", () => {
    const blocks = blocksOf([widget("a", { col: 1, row: 1, colSpan: 12, rowSpan: 2 })]);
    expect(freeRunIn(blocks, 1, 2, 3, "a")).toBe(1);
  });
});
