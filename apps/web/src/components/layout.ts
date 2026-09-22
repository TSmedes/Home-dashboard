import { type WidgetInstance } from "@home-dash/shared";

export type Cell =
  /** A widget at a fixed place on the 12-column grid. */
  | { kind: "widget"; key: string; widget: WidgetInstance; column: string; row: string }
  /** A shared row: its showing widgets split the full width evenly. */
  | { kind: "band"; key: string; widgets: WidgetInstance[]; row: string }
  /** A shared column: its showing widgets split one rectangle top to bottom. */
  | { kind: "stack"; key: string; widgets: WidgetInstance[]; column: string; row: string };

/** Whether a widget is on screen. Switched on in settings, by default. */
export type Showing = (widget: WidgetInstance) => boolean;

const enabled: Showing = (widget) => widget.enabled;

/** The smallest rectangle covering every one of these widgets. */
function union(widgets: WidgetInstance[]): { column: string; row: string } {
  const cols = widgets.map((w) => w.grid.col ?? 1);
  const rows = widgets.map((w) => w.grid.row);
  const col = Math.min(...cols);
  const row = Math.min(...rows);
  const right = Math.max(...widgets.map((w) => (w.grid.col ?? 1) + w.grid.colSpan));
  const bottom = Math.max(...widgets.map((w) => w.grid.row + w.grid.rowSpan));
  return { column: `${col} / span ${right - col}`, row: `${row} / span ${bottom - row}` };
}

/**
 * Where each showing widget goes.
 *
 * Fixed widgets keep their own place, so hiding one leaves its space empty.
 * Shared widgets on the same rows become one band that divides the width among
 * whichever are showing, and widgets naming the same stack become one column
 * that divides its height the same way - so hiding one never leaves a gap.
 * The row count, and each band's and stack's rectangle, come from every widget
 * whether showing or not, so nothing grows or shifts when something is hidden.
 *
 * `showing` lets a widget hide itself for a reason of its own - bin day is off
 * the wall between collections - on top of being switched off in settings.
 */
export function layout(widgets: WidgetInstance[], showing: Showing = enabled): { rows: number; cells: Cell[] } {
  const rows = widgets.reduce((max, w) => Math.max(max, w.grid.row + w.grid.rowSpan - 1), 1);
  const cells: Cell[] = [];
  const bands = new Map<string, Extract<Cell, { kind: "band" }>>();
  const stacks = new Map<string, { cell: Extract<Cell, { kind: "stack" }>; members: WidgetInstance[] }>();

  for (const widget of widgets) {
    const row = `${widget.grid.row} / span ${widget.grid.rowSpan}`;

    if (widget.grid.stack) {
      const name = widget.grid.stack;
      let stack = stacks.get(name);
      if (!stack) {
        // The stack takes its place in the order of its first widget; its
        // rectangle is filled in once every member is known.
        const cell: Extract<Cell, { kind: "stack" }> = { kind: "stack", key: `stack ${name}`, widgets: [], column: "", row: "" };
        stack = { cell, members: [] };
        stacks.set(name, stack);
        cells.push(cell);
      }
      stack.members.push(widget);
      if (showing(widget)) stack.cell.widgets.push(widget);
      continue;
    }

    if (widget.grid.share) {
      let band = bands.get(row);
      if (!band) {
        // The band takes its place in the order of its first widget.
        band = { kind: "band", key: `band ${row}`, widgets: [], row };
        bands.set(row, band);
        cells.push(band);
      }
      if (showing(widget)) band.widgets.push(widget);
      continue;
    }

    if (!showing(widget)) continue;
    cells.push({
      kind: "widget",
      key: widget.id,
      widget,
      column: `${widget.grid.col ?? 1} / span ${widget.grid.colSpan}`,
      row,
    });
  }

  // Hidden members still count towards the rectangle, so a stack covers the
  // same ground whoever is in it.
  for (const { cell, members } of stacks.values()) Object.assign(cell, union(members));

  return { rows, cells: cells.filter((cell) => cell.kind === "widget" || cell.widgets.length > 0) };
}
