import { GRID_COLUMNS } from "@home-dash/shared";
import type { Rect } from "./grid.js";

/**
 * Turning a finger's travel into cells.
 *
 * Kept apart from the pointer handling, and expressed in plain numbers, so the
 * arithmetic that decides where a tile lands can be tested without a browser -
 * which is the part worth testing, and the part impossible to check by eye on
 * a wall-mounted iPad.
 */

/** How far apart one column (or row) starts from the next, the gap included. */
export interface Units {
  colUnit: number;
  rowUnit: number;
}

/**
 * Measure the grid's pitch from its box.
 *
 * Twelve columns and eleven gaps make up the width, so one column is
 * (width - 11 * gap) / 12 and the pitch is that plus the gap - which tidies to
 * (width + gap) / 12.
 */
export function gridUnits(width: number, height: number, rows: number, gap: number): Units {
  return {
    colUnit: (width + gap) / GRID_COLUMNS,
    rowUnit: (height + gap) / Math.max(rows, 1),
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Where a tile lands after being dragged this far.
 *
 * The travel is measured from where the drag began rather than from the
 * pointer's position on screen, which keeps the spot you grabbed under your
 * finger - the difference between a tile that follows you and one that jumps
 * to centre itself the moment you touch it.
 *
 * The result is clamped to the page, so a drag off the edge parks against it
 * instead of producing a rectangle the grid cannot place.
 */
export function snapRect(start: Rect, dx: number, dy: number, units: Units, rows: number): Rect {
  return {
    ...start,
    col: clamp(start.col + Math.round(dx / units.colUnit), 1, GRID_COLUMNS - start.colSpan + 1),
    row: clamp(start.row + Math.round(dy / units.rowUnit), 1, rows - start.rowSpan + 1),
  };
}
