import { GRID_COLUMNS, type WidgetInstance } from "@home-dash/shared";
import { groupWidgets } from "../components/layout.js";

/**
 * The grid as numbers.
 *
 * `components/layout.ts` turns widgets into the CSS strings the browser needs;
 * this turns the same groups into rectangles the editor can test against each
 * other. Both read `groupWidgets`, so what the editor believes is occupied is
 * what the grid will actually place.
 *
 * Everything here is a pure function of plain numbers, so the rules that decide
 * whether a drop is allowed can be tested without a browser.
 */

/** A rectangle on the grid, in CSS grid's 1-based lines. */
export interface Rect {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

/** A placed rectangle, and the widgets inside it. */
export interface Block {
  /** The group's key: a widget id, `band <rows>`, or `stack <name>`. */
  key: string;
  kind: "widget" | "band" | "stack";
  rect: Rect;
  /** Every member, showing or not - the space is claimed either way. */
  members: WidgetInstance[];
}

const right = (r: Rect) => r.col + r.colSpan;
const bottom = (r: Rect) => r.row + r.rowSpan;

/** The smallest rectangle covering every one of these widgets. */
function union(widgets: WidgetInstance[]): Rect {
  const col = Math.min(...widgets.map((w) => w.grid.col ?? 1));
  const row = Math.min(...widgets.map((w) => w.grid.row));
  return {
    col,
    row,
    colSpan: Math.max(...widgets.map((w) => (w.grid.col ?? 1) + w.grid.colSpan)) - col,
    rowSpan: Math.max(...widgets.map((w) => w.grid.row + w.grid.rowSpan)) - row,
  };
}

/**
 * Every rectangle placed on one page.
 *
 * A band claims the full width of the rows it shares, because that is what it
 * takes on screen however few of its members are switched on. A stack claims
 * the union of its members for the same reason.
 */
export function blocksOf(widgets: WidgetInstance[]): Block[] {
  return groupWidgets(widgets).map((group): Block => {
    if (group.kind === "band") {
      const first = group.members[0]!;
      return {
        key: group.key,
        kind: "band",
        rect: { col: 1, row: first.grid.row, colSpan: GRID_COLUMNS, rowSpan: first.grid.rowSpan },
        members: group.members,
      };
    }
    if (group.kind === "stack") {
      return { key: group.key, kind: "stack", rect: union(group.members), members: group.members };
    }
    const w = group.members[0]!;
    return {
      key: w.id,
      kind: "widget",
      rect: { col: w.grid.col ?? 1, row: w.grid.row, colSpan: w.grid.colSpan, rowSpan: w.grid.rowSpan },
      members: group.members,
    };
  });
}

/** How many rows the page needs. Mirrors `layout()`, switched-off widgets included. */
export function rowsOf(widgets: WidgetInstance[]): number {
  return widgets.reduce((max, w) => Math.max(max, w.grid.row + w.grid.rowSpan - 1), 1);
}

/** Whether two rectangles share any cell. Touching edge to edge does not count. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.col < right(b) && b.col < right(a) && a.row < bottom(b) && b.row < bottom(a);
}

/** The block covering this cell, if any. */
export function blockAt(blocks: Block[], col: number, row: number): Block | null {
  return blocks.find((b) => overlaps(b.rect, { col, row, colSpan: 1, rowSpan: 1 })) ?? null;
}

const inBounds = (r: Rect) =>
  r.col >= 1 && r.row >= 1 && r.colSpan >= 1 && r.rowSpan >= 1 && right(r) - 1 <= GRID_COLUMNS;

/** Everything `rect` would land on, other than the block being moved. */
function hits(blocks: Block[], movingKey: string, rect: Rect): Block[] {
  return blocks.filter((b) => b.key !== movingKey && overlaps(b.rect, rect));
}

/** Whether `rect` fits the grid with nothing but the moving block in the way. */
export function canPlace(blocks: Block[], movingKey: string, rect: Rect): boolean {
  return inBounds(rect) && hits(blocks, movingKey, rect).length === 0;
}

/**
 * The block a drop here would trade places with: one occupant, exactly the same
 * size. Landing across two widgets, or on one of a different shape, has no
 * sensible swap - there is nowhere for the other to go.
 */
export function findSwapTarget(blocks: Block[], movingKey: string, rect: Rect): Block | null {
  const landed = hits(blocks, movingKey, rect);
  if (landed.length !== 1) return null;
  const target = landed[0]!;
  return target.rect.colSpan === rect.colSpan && target.rect.rowSpan === rect.rowSpan ? target : null;
}

export type Drop =
  | { kind: "free" }
  | { kind: "swap"; withKey: string }
  | { kind: "blocked" };

/** Free space is always allowed; a same-size occupant swaps; anything else refuses. */
export function dropOutcome(blocks: Block[], movingKey: string, rect: Rect): Drop {
  if (!inBounds(rect)) return { kind: "blocked" };
  if (hits(blocks, movingKey, rect).length === 0) return { kind: "free" };
  const swap = findSwapTarget(blocks, movingKey, rect);
  return swap ? { kind: "swap", withKey: swap.key } : { kind: "blocked" };
}

/**
 * Resize by whole cells, stopping at the grid edge, the bottom of the page, or
 * the first thing in the way.
 *
 * Growing goes one cell at a time so a tile asked for more room than it has
 * takes what there is instead of refusing outright - the buttons stop feeling
 * broken when a widget is already nearly against its neighbour.
 */
export function clampResize(
  blocks: Block[],
  key: string,
  rect: Rect,
  delta: { colSpan?: number; rowSpan?: number },
  rows: number,
): Rect {
  let out = { ...rect };

  for (const axis of ["colSpan", "rowSpan"] as const) {
    const want = delta[axis] ?? 0;
    if (want < 0) {
      out = { ...out, [axis]: Math.max(1, out[axis] + want) };
      continue;
    }
    for (let step = 0; step < want; step += 1) {
      const next = { ...out, [axis]: out[axis] + 1 };
      // The page's own height is a limit too: the grid divides the screen into
      // exactly these rows, so growing past the last one has nowhere to show.
      if (axis === "rowSpan" && bottom(next) - 1 > rows) break;
      if (!canPlace(blocks, key, next)) break;
      out = next;
    }
  }

  return out;
}

/**
 * Somewhere sensible to put a new tile: the first free rectangle reading across
 * and then down. When the page is full it goes on a new row underneath, which
 * grows the page rather than refusing to add the widget.
 */
export function freeRectFor(blocks: Block[], want: { colSpan: number; rowSpan: number }, rows: number): Rect {
  for (let row = 1; row + want.rowSpan - 1 <= rows; row += 1) {
    for (let col = 1; col + want.colSpan - 1 <= GRID_COLUMNS; col += 1) {
      const rect = { col, row, ...want };
      if (canPlace(blocks, "", rect)) return rect;
    }
  }
  return { col: 1, row: rows + 1, ...want };
}

/**
 * The leftmost free run of `colSpan` columns across these rows, or null if
 * there is none - where a widget leaving a band can land without moving house.
 *
 * `ignoreKey` is the block it is leaving: a band covers all twelve columns, so
 * without discounting it nothing on those rows ever looks free.
 */
export function freeRunIn(
  blocks: Block[],
  row: number,
  rowSpan: number,
  colSpan: number,
  ignoreKey = "",
): number | null {
  for (let col = 1; col + colSpan - 1 <= GRID_COLUMNS; col += 1) {
    if (canPlace(blocks, ignoreKey, { col, row, colSpan, rowSpan })) return col;
  }
  return null;
}
