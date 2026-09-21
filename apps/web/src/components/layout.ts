import type { WidgetInstance } from "@home-dash/shared";

export type Cell =
  /** A widget at a fixed place on the 12-column grid. */
  | { kind: "widget"; key: string; widget: WidgetInstance; column: string; row: string }
  /** A shared row: its switched-on widgets split the full width evenly. */
  | { kind: "band"; key: string; widgets: WidgetInstance[]; row: string };

/**
 * Where each switched-on widget goes.
 *
 * Fixed widgets keep their own place, so switching one off leaves its space
 * empty. Shared widgets on the same rows become one band that divides the
 * width among whichever are on, so switching one off never leaves a gap.
 * The row count comes from every widget, on or off, so nothing grows taller
 * when something is switched off.
 */
export function layout(widgets: WidgetInstance[]): { rows: number; cells: Cell[] } {
  const rows = widgets.reduce((max, w) => Math.max(max, w.grid.row + w.grid.rowSpan - 1), 1);
  const cells: Cell[] = [];
  const bands = new Map<string, Extract<Cell, { kind: "band" }>>();

  for (const widget of widgets) {
    const row = `${widget.grid.row} / span ${widget.grid.rowSpan}`;

    if (widget.grid.share) {
      let band = bands.get(row);
      if (!band) {
        // The band takes its place in the order of its first widget.
        band = { kind: "band", key: `band ${row}`, widgets: [], row };
        bands.set(row, band);
        cells.push(band);
      }
      if (widget.enabled) band.widgets.push(widget);
      continue;
    }

    if (!widget.enabled) continue;
    cells.push({
      kind: "widget",
      key: widget.id,
      widget,
      column: `${widget.grid.col ?? 1} / span ${widget.grid.colSpan}`,
      row,
    });
  }

  return { rows, cells: cells.filter((cell) => cell.kind === "widget" || cell.widgets.length > 0) };
}
