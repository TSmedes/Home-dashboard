import { type WidgetInstance } from "@home-dash/shared";

/**
 * How widgets gather into the things the grid actually places.
 *
 * A widget either sits on its own, shares its rows with others as a band, or
 * shares a column with others as a stack. Working that out is one rule with two
 * consumers - `layout` below turns groups into CSS, and the editor turns the
 * same groups into rectangles it can test for collisions - so it lives here
 * rather than being written twice and drifting apart.
 *
 * Members are every widget in the group, showing or not: a group covers the
 * same ground whoever is currently in it.
 */
export type Group =
  /** One widget at a fixed place on the 12-column grid. */
  | { kind: "widget"; key: string; members: [WidgetInstance] }
  /** Widgets sharing the same rows, keyed by the rows they share. */
  | { kind: "band"; key: string; row: string; members: WidgetInstance[] }
  /** Widgets naming the same stack, keyed by its name. */
  | { kind: "stack"; key: string; name: string; members: WidgetInstance[] };

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

/** The rows a widget covers, written the way CSS grid wants them. */
export const rowLine = (widget: WidgetInstance): string => `${widget.grid.row} / span ${widget.grid.rowSpan}`;

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
 * Gather widgets into groups, in the order the grid should place them: a group
 * takes the place of its first member.
 *
 * `stack` is tested before `share`, so a widget naming a stack is a stack
 * member even if it also says `share` - the two are mutually exclusive, and the
 * editor never writes both.
 */
export function groupWidgets(widgets: WidgetInstance[]): Group[] {
  const groups: Group[] = [];
  const bands = new Map<string, Extract<Group, { kind: "band" }>>();
  const stacks = new Map<string, Extract<Group, { kind: "stack" }>>();

  for (const widget of widgets) {
    if (widget.grid.stack) {
      const name = widget.grid.stack;
      let stack = stacks.get(name);
      if (!stack) {
        stack = { kind: "stack", key: `stack ${name}`, name, members: [] };
        stacks.set(name, stack);
        groups.push(stack);
      }
      stack.members.push(widget);
      continue;
    }

    if (widget.grid.share) {
      // Keyed by the rows themselves, so sharing a row means sharing its whole
      // extent - the same row and the same rowSpan, not merely starting level.
      const row = rowLine(widget);
      let band = bands.get(row);
      if (!band) {
        band = { kind: "band", key: `band ${row}`, row, members: [] };
        bands.set(row, band);
        groups.push(band);
      }
      band.members.push(widget);
      continue;
    }

    groups.push({ kind: "widget", key: widget.id, members: [widget] });
  }

  return groups;
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

  const cells = groupWidgets(widgets).map((group): Cell => {
    if (group.kind === "band") {
      return { kind: "band", key: group.key, widgets: group.members.filter(showing), row: group.row };
    }
    if (group.kind === "stack") {
      // Hidden members still count towards the rectangle, so a stack covers the
      // same ground whoever is in it.
      return { kind: "stack", key: group.key, widgets: group.members.filter(showing), ...union(group.members) };
    }
    const widget = group.members[0];
    return {
      kind: "widget",
      key: widget.id,
      widget,
      column: `${widget.grid.col ?? 1} / span ${widget.grid.colSpan}`,
      row: rowLine(widget),
    };
  });

  return {
    rows,
    cells: cells.filter((cell) => (cell.kind === "widget" ? showing(cell.widget) : cell.widgets.length > 0)),
  };
}
