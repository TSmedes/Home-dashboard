import { describe, expect, it } from "vitest";
import { gridUnits, snapRect, type Units } from "./geometry.js";

// A grid 1186px wide and 586px tall over 6 rows, with the stylesheet's 14px
// gap, works out at a round 100px from one column (or row) to the next.
const units: Units = gridUnits(1186, 586, 6, 14);

const start = { col: 3, row: 2, colSpan: 4, rowSpan: 2 };

describe("gridUnits", () => {
  it("measures the pitch from one column to the next, gap included", () => {
    expect(units).toEqual({ colUnit: 100, rowUnit: 100 });
  });

  it("splits the width into twelve columns however wide the screen is", () => {
    const { colUnit } = gridUnits(1024 - 14, 100, 1, 14);
    // Twelve columns and eleven gaps have to add back up to the grid's width.
    expect(colUnit * 12 - 14).toBeCloseTo(1010);
  });
});

describe("snapRect", () => {
  it("stays put for a drag of nothing", () => {
    expect(snapRect(start, 0, 0, units, 6)).toEqual(start);
  });

  it("ignores a drag of less than half a cell", () => {
    expect(snapRect(start, 49, -49, units, 6)).toEqual(start);
  });

  it("moves a column once the drag passes halfway", () => {
    expect(snapRect(start, 51, 0, units, 6)).toMatchObject({ col: 4, row: 2 });
  });

  it("rounds a cell and a half up to two", () => {
    expect(snapRect(start, 150, 0, units, 6)).toMatchObject({ col: 5 });
  });

  it("moves up and left on a negative drag", () => {
    expect(snapRect(start, -200, -100, units, 6)).toMatchObject({ col: 1, row: 1 });
  });

  it("keeps the tile's size", () => {
    expect(snapRect(start, 300, 200, units, 6)).toMatchObject({ colSpan: 4, rowSpan: 2 });
  });

  it("stops at the first column and row", () => {
    expect(snapRect(start, -9999, -9999, units, 6)).toMatchObject({ col: 1, row: 1 });
  });

  it("stops with its right edge on the last column", () => {
    // A 4-wide tile can start no further right than column 9.
    expect(snapRect(start, 9999, 0, units, 6)).toMatchObject({ col: 9 });
  });

  it("stops with its bottom edge on the last row of the page", () => {
    // A 2-tall tile on a 6-row page can start no lower than row 5.
    expect(snapRect(start, 0, 9999, units, 6)).toMatchObject({ row: 5 });
  });

  it("pins a tile that fills the grid to the top left", () => {
    const full = { col: 1, row: 1, colSpan: 12, rowSpan: 6 };
    expect(snapRect(full, 9999, 9999, units, 6)).toEqual(full);
  });
});
