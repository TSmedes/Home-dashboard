import { GRID_COLUMNS, type WidgetInstance } from "@home-dash/shared";
import { groupWidgets } from "../components/layout.js";
import { blocksOf, canPlace, freeRectFor, freeRunIn, rowsOf, type Block, type Rect } from "./grid.js";

/**
 * Every way edit mode changes a profile's widgets.
 *
 * All of these are `(widgets, ...) => widgets`: they take the list as it is and
 * give back a new one, touching nothing else. That is what lets the editor keep
 * a working copy and throw it away on Cancel, and it is why the awkward parts -
 * what happens to `col` when a widget joins a band, where a widget lands when
 * it leaves a stack - can be checked in a test instead of on the wall.
 *
 * The list is the whole profile's, but placement is always per page: two
 * widgets on different pages never collide.
 */

/** The default size for a newly added tile: wide enough to read across a room. */
const NEW_WIDGET_SIZE = { colSpan: 4, rowSpan: 2 };

/** The widgets on one page, in config order. */
export const onPage = (widgets: WidgetInstance[], page: number): WidgetInstance[] =>
  widgets.filter((w) => w.page === page);

/** Replace one widget, leaving the order and everything else alone. */
function withWidget(
  widgets: WidgetInstance[],
  id: string,
  change: (widget: WidgetInstance) => WidgetInstance,
): WidgetInstance[] {
  return widgets.map((w) => (w.id === id ? change(w) : w));
}

const withGrid = (widget: WidgetInstance, grid: Partial<WidgetInstance["grid"]>): WidgetInstance => ({
  ...widget,
  grid: { ...widget.grid, ...grid },
});

/** Drop a key from the grid rather than writing a meaningless value into it. */
function withoutGrid(widget: WidgetInstance, key: "col" | "stack"): WidgetInstance {
  const { [key]: _dropped, ...rest } = widget.grid;
  return { ...widget, grid: rest as WidgetInstance["grid"] };
}

/** Move a widget to sit immediately after another, which is what group order means. */
function moveAfter(widgets: WidgetInstance[], id: string, afterId: string): WidgetInstance[] {
  const moving = widgets.find((w) => w.id === id);
  if (!moving || id === afterId) return widgets;
  const rest = widgets.filter((w) => w.id !== id);
  const at = rest.findIndex((w) => w.id === afterId);
  if (at === -1) return widgets;
  return [...rest.slice(0, at + 1), moving, ...rest.slice(at + 1)];
}

/**
 * An id not already taken, derived from the widget's type so config.yaml stays
 * readable: `weather`, then `weather-2`.
 */
export function uniqueWidgetId(widgets: WidgetInstance[], type: string): string {
  const taken = new Set(widgets.map((w) => w.id));
  if (!taken.has(type)) return type;
  for (let n = 2; ; n += 1) {
    const id = `${type}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** A stack name not already taken, named after the widget it starts with. */
export function uniqueStackName(widgets: WidgetInstance[], seed: string): string {
  const taken = new Set(widgets.map((w) => w.grid.stack).filter(Boolean));
  const base = `${seed}-stack`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const name = `${base}-${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * The pages of a profile, in order, always including the one being looked at.
 *
 * A page is only a number on its widgets, so a page with nothing on it does
 * not exist yet - which is exactly what "add a page" makes: somewhere to put
 * the next widget. Including `current` is what keeps it on screen until
 * something lands on it.
 */
export function pageNumbers(widgets: WidgetInstance[], current: number): number[] {
  const numbers = new Set(widgets.map((w) => w.page));
  numbers.add(current);
  return [...numbers].sort((a, b) => a - b);
}

/** The number a new page gets. Gaps are fine - pages are ordered, not indexed. */
export const nextPageNumber = (widgets: WidgetInstance[]): number =>
  widgets.reduce((max, w) => Math.max(max, w.page), 0) + 1;

/** The blocks on a widget's page, optionally as if some widget were not there. */
function pageBlocks(widgets: WidgetInstance[], page: number, without = ""): Block[] {
  return blocksOf(onPage(widgets, page).filter((w) => w.id !== without));
}

/** Put a widget at a rectangle. Moving and resizing are the same edit. */
export function placeWidget(widgets: WidgetInstance[], id: string, rect: Rect): WidgetInstance[] {
  return withWidget(widgets, id, (w) => withGrid(w, rect));
}

/**
 * Trade two blocks' places, members and all.
 *
 * Shifting every member by the same amount keeps a band's or a stack's internal
 * arrangement intact, so swapping a stack with its neighbour moves the column
 * rather than scrambling what is in it.
 */
export function swapBlocks(widgets: WidgetInstance[], page: number, keyA: string, keyB: string): WidgetInstance[] {
  const blocks = pageBlocks(widgets, page);
  const a = blocks.find((b) => b.key === keyA);
  const b = blocks.find((b) => b.key === keyB);
  if (!a || !b) return widgets;

  const shift = (members: WidgetInstance[], dCol: number, dRow: number) =>
    new Map(members.map((w) => [w.id, { col: (w.grid.col ?? 1) + dCol, row: w.grid.row + dRow }]));

  const moves = new Map([
    ...shift(a.members, b.rect.col - a.rect.col, b.rect.row - a.rect.row),
    ...shift(b.members, a.rect.col - b.rect.col, a.rect.row - b.rect.row),
  ]);

  return widgets.map((w) => {
    const to = moves.get(w.id);
    if (!to) return w;
    // A band member has no column of its own; only its rows move.
    return withGrid(w, w.grid.col === undefined ? { row: to.row } : to);
  });
}

// --- Bands: widgets sharing the full width of the same rows -----------------

/** Whether these widgets could share their rows without displacing anything else. */
export function canCreateBand(widgets: WidgetInstance[], ids: string[]): boolean {
  if (ids.length < 2) return false;
  const members = widgets.filter((w) => ids.includes(w.id));
  if (members.length !== ids.length) return false;
  const page = members[0]!.page;
  if (members.some((w) => w.page !== page || w.grid.stack)) return false;

  // A band claims all twelve columns of its rows, so nothing else may be on them.
  const row = Math.min(...members.map((w) => w.grid.row));
  const rowSpan = Math.max(...members.map((w) => w.grid.row + w.grid.rowSpan)) - row;
  const others = blocksOf(onPage(widgets, page).filter((w) => !ids.includes(w.id)));
  return canPlace(others, "", { col: 1, row, colSpan: GRID_COLUMNS, rowSpan });
}

/** Make these widgets share their rows. Order among them follows the config. */
export function createBand(widgets: WidgetInstance[], ids: string[]): WidgetInstance[] {
  if (!canCreateBand(widgets, ids)) return widgets;
  const members = widgets.filter((w) => ids.includes(w.id));
  const row = Math.min(...members.map((w) => w.grid.row));
  const rowSpan = Math.max(...members.map((w) => w.grid.row + w.grid.rowSpan)) - row;

  return widgets.map((w) =>
    ids.includes(w.id) ? withGrid(withoutGrid(w, "col"), { row, rowSpan, share: true }) : w,
  );
}

/** Put a widget into an existing band, last in its order. */
export function joinBand(widgets: WidgetInstance[], id: string, bandKey: string): WidgetInstance[] {
  const widget = widgets.find((w) => w.id === id);
  if (!widget) return widgets;
  const band = groupWidgets(onPage(widgets, widget.page)).find((g) => g.kind === "band" && g.key === bandKey);
  if (!band) return widgets;

  const first = band.members[0]!;
  const joined = withWidget(widgets, id, (w) =>
    withGrid(withoutGrid(w, "col"), { row: first.grid.row, rowSpan: first.grid.rowSpan, share: true }),
  );
  return moveAfter(joined, id, band.members.at(-1)!.id);
}

/**
 * Take a widget out of a band and give it a column of its own.
 *
 * It keeps the rows it had if there is a free run wide enough on them, which is
 * where it already appeared to be. Otherwise the rest of the band has claimed
 * those rows and it has to go somewhere else on the page.
 */
export function leaveBand(widgets: WidgetInstance[], id: string): WidgetInstance[] {
  const widget = widgets.find((w) => w.id === id);
  if (!widget?.grid.share) return widgets;

  const others = pageBlocks(widgets, widget.page, id);
  const { row, rowSpan, colSpan } = widget.grid;
  const col = freeRunIn(others, row, rowSpan, colSpan);
  const rect = col === null ? freeRectFor(others, { colSpan, rowSpan }, rowsOf(onPage(widgets, widget.page))) : { col, row, colSpan, rowSpan };

  return withWidget(widgets, id, (w) => withGrid(w, { ...rect, share: false }));
}

// --- Stacks: widgets sharing one column, top to bottom ----------------------

/** Whether these widgets already form a column that nothing else sits in. */
export function canCreateStack(widgets: WidgetInstance[], ids: string[]): boolean {
  if (ids.length < 2) return false;
  const members = widgets.filter((w) => ids.includes(w.id));
  if (members.length !== ids.length) return false;
  const page = members[0]!.page;
  if (members.some((w) => w.page !== page || w.grid.share || w.grid.stack)) return false;

  const col = Math.min(...members.map((w) => w.grid.col ?? 1));
  const row = Math.min(...members.map((w) => w.grid.row));
  const colSpan = Math.max(...members.map((w) => (w.grid.col ?? 1) + w.grid.colSpan)) - col;
  const rowSpan = Math.max(...members.map((w) => w.grid.row + w.grid.rowSpan)) - row;
  const others = blocksOf(onPage(widgets, page).filter((w) => !ids.includes(w.id)));
  return canPlace(others, "", { col, row, colSpan, rowSpan });
}

/** Make these widgets share a column. Their rectangles already say which one. */
export function createStack(widgets: WidgetInstance[], ids: string[]): WidgetInstance[] {
  if (!canCreateStack(widgets, ids)) return widgets;
  const name = uniqueStackName(widgets, widgets.find((w) => ids.includes(w.id))!.id);
  const stacked = widgets.map((w) => (ids.includes(w.id) ? withGrid(w, { stack: name, share: false }) : w));
  return normaliseStack(stacked, name);
}

/** Whether a widget could drop into the bottom of this stack without pushing anything aside. */
export function canJoinStack(widgets: WidgetInstance[], id: string, name: string): boolean {
  const widget = widgets.find((w) => w.id === id);
  if (!widget || widget.grid.stack === name) return false;
  const stack = blocksOf(onPage(widgets, widget.page)).find((b) => b.key === `stack ${name}`);
  if (!stack) return false;

  // The stack grows downwards by the newcomer's height; those rows must be free.
  const grown = { ...stack.rect, rowSpan: stack.rect.rowSpan + widget.grid.rowSpan };
  const others = pageBlocks(widgets, widget.page, id).filter((b) => b.key !== stack.key);
  return canPlace(others, "", grown);
}

/** Put a widget at the bottom of a stack, adopting its column. */
export function joinStack(widgets: WidgetInstance[], id: string, name: string): WidgetInstance[] {
  if (!canJoinStack(widgets, id, name)) return widgets;
  const widget = widgets.find((w) => w.id === id)!;
  const stack = blocksOf(onPage(widgets, widget.page)).find((b) => b.key === `stack ${name}`)!;

  const joined = withWidget(widgets, id, (w) =>
    withGrid(w, {
      col: stack.rect.col,
      colSpan: stack.rect.colSpan,
      row: stack.rect.row + stack.rect.rowSpan,
      stack: name,
      share: false,
    }),
  );
  return normaliseStack(moveAfter(joined, id, stack.members.at(-1)!.id), name);
}

/**
 * Take a widget out of a stack.
 *
 * Its own rectangle already describes where it appeared - which is only true
 * because normaliseStack keeps member rows matching their order - so it simply
 * becomes a fixed tile there, and the rest of the column closes up.
 */
export function leaveStack(widgets: WidgetInstance[], id: string): WidgetInstance[] {
  const widget = widgets.find((w) => w.id === id);
  if (!widget?.grid.stack) return widgets;
  return normaliseStack(withWidget(widgets, id, (w) => withoutGrid(w, "stack")), widget.grid.stack);
}

/**
 * Lay a stack's members out down its column in the order they are written.
 *
 * While they are stacked this is invisible - the renderer divides the union
 * between whoever is showing regardless. It matters the moment a member leaves:
 * without it, a widget taken out of a stack lands at whatever row it happened
 * to be written with, which may be nowhere near where it appeared.
 *
 * `top` is the row to start from. By default the column keeps the top it has
 * now, which is right when a member has left and is still sitting there. A
 * member that was deleted frees its rows, so removeWidget passes the row the
 * stack started at and the rest close up into the gap.
 */
export function normaliseStack(widgets: WidgetInstance[], name: string, top?: number): WidgetInstance[] {
  const members = widgets.filter((w) => w.grid.stack === name);
  if (members.length === 0) return widgets;

  const col = Math.min(...members.map((w) => w.grid.col ?? 1));
  const colSpan = Math.max(...members.map((w) => (w.grid.col ?? 1) + w.grid.colSpan)) - col;
  let row = top ?? Math.min(...members.map((w) => w.grid.row));

  const rows = new Map<string, number>();
  for (const member of members) {
    rows.set(member.id, row);
    row += member.grid.rowSpan;
  }

  return widgets.map((w) => (rows.has(w.id) ? withGrid(w, { col, colSpan, row: rows.get(w.id)! }) : w));
}

/**
 * Move a widget one place earlier or later among the others in its group.
 *
 * Bands read left to right and stacks top to bottom, both in config order, so
 * this is a splice - and for a stack, the rows have to follow.
 */
export function reorder(widgets: WidgetInstance[], id: string, delta: -1 | 1): WidgetInstance[] {
  const widget = widgets.find((w) => w.id === id);
  if (!widget) return widgets;
  const group = groupWidgets(onPage(widgets, widget.page)).find((g) => g.members.some((w) => w.id === id));
  if (!group || group.kind === "widget") return widgets;

  const order = group.members.map((w) => w.id);
  const at = order.indexOf(id);
  const to = at + delta;
  if (to < 0 || to >= order.length) return widgets;

  // Swap the two members' positions in the profile's own list.
  const swapped = [...widgets];
  const i = swapped.findIndex((w) => w.id === id);
  const j = swapped.findIndex((w) => w.id === order[to]);
  [swapped[i]!, swapped[j]!] = [swapped[j]!, swapped[i]!];

  return group.kind === "stack" ? normaliseStack(swapped, group.name) : swapped;
}

// --- What grouping a tile could join ----------------------------------------

/** A band or stack already on this page, named for a menu. */
export interface GroupOption {
  /** The block key: `band <rows>` for a band, the stack's name for a stack. */
  key: string;
  kind: "band" | "stack";
  /** What a stack is called in the file; a band has no name of its own. */
  name: string;
  members: WidgetInstance[];
}

/** The bands and stacks on a widget's page that it is not already in. */
export function groupsFor(widgets: WidgetInstance[], id: string): GroupOption[] {
  const widget = widgets.find((w) => w.id === id);
  if (!widget) return [];

  return groupWidgets(onPage(widgets, widget.page))
    .filter((group) => group.kind !== "widget" && !group.members.some((w) => w.id === id))
    .map((group) =>
      group.kind === "stack"
        ? { key: group.key, kind: "stack" as const, name: group.name, members: group.members }
        : { key: group.key, kind: "band" as const, name: "", members: group.members },
    )
    // A band takes whoever asks; a stack has to have the room below it.
    .filter((group) => group.kind === "band" || canJoinStack(widgets, id, group.name));
}

/**
 * Tiles this one could pair up with to start a group.
 *
 * A band needs partners covering exactly the same rows, because that is what
 * sharing a row means; a stack needs partners in exactly the same columns.
 * Anything looser would move the other tile to make it fit, which is not what
 * "share this row with that one" should do.
 */
export function partnersFor(widgets: WidgetInstance[], id: string, kind: "band" | "stack"): WidgetInstance[] {
  const widget = widgets.find((w) => w.id === id);
  if (!widget || widget.grid.share || widget.grid.stack) return [];

  return onPage(widgets, widget.page).filter((other) => {
    if (other.id === id || other.grid.share || other.grid.stack) return false;
    const aligned =
      kind === "band"
        ? other.grid.row === widget.grid.row && other.grid.rowSpan === widget.grid.rowSpan
        : other.grid.col === widget.grid.col && other.grid.colSpan === widget.grid.colSpan;
    if (!aligned) return false;
    return kind === "band"
      ? canCreateBand(widgets, [id, other.id])
      : canCreateStack(widgets, [id, other.id]);
  });
}

// --- Adding, removing, and pages --------------------------------------------

/** Add a widget of this type to a page, wherever there is room. */
export function addWidget(
  widgets: WidgetInstance[],
  type: string,
  page: number,
  size = NEW_WIDGET_SIZE,
): WidgetInstance[] {
  const here = onPage(widgets, page);
  // A page is as tall as what is on it, so an empty one has a single row. It
  // has to be allowed to grow to the height of the tile being added, or the
  // first widget on a new page lands below the fold.
  const rect = freeRectFor(blocksOf(here), size, Math.max(rowsOf(here), size.rowSpan));
  return [
    ...widgets,
    { id: uniqueWidgetId(widgets, type), type, enabled: true, page, options: {}, grid: { ...rect, share: false } },
  ];
}

/** Take a widget off the dashboard. A stack it was in closes up behind it. */
export function removeWidget(widgets: WidgetInstance[], id: string): WidgetInstance[] {
  const widget = widgets.find((w) => w.id === id);
  if (!widget) return widgets;
  const rest = widgets.filter((w) => w.id !== id);
  if (!widget.grid.stack) return rest;
  // The column closes up into the space the deleted widget gave back.
  const top = Math.min(...widgets.filter((w) => w.grid.stack === widget.grid.stack).map((w) => w.grid.row));
  return normaliseStack(rest, widget.grid.stack, top);
}

/** Send a widget to another page, finding it room there. */
export function moveToPage(widgets: WidgetInstance[], id: string, page: number): WidgetInstance[] {
  const widget = widgets.find((w) => w.id === id);
  if (!widget || widget.page === page) return widgets;

  const there = onPage(widgets, page);
  const { colSpan, rowSpan } = widget.grid;
  const rect = freeRectFor(blocksOf(there), { colSpan, rowSpan }, rowsOf(there));

  // It leaves any group behind: a band or stack belongs to the page it is on.
  const moved = withWidget(widgets, id, (w) => ({
    ...withGrid(withoutGrid(w, "stack"), { ...rect, share: false }),
    page,
  }));
  return widget.grid.stack ? normaliseStack(moved, widget.grid.stack) : moved;
}

/**
 * Empty a page and everything on it.
 *
 * The numbers of the pages after it are left alone: pages are shown in the
 * order of their numbers, not indexed by them, so a gap is invisible - and
 * renumbering would rewrite every widget on every later page for nothing.
 */
export function removePage(widgets: WidgetInstance[], page: number): WidgetInstance[] {
  const rest = widgets.filter((w) => w.page !== page);
  // Never leave a profile with nowhere to show anything.
  return rest.length === 0 ? widgets : rest;
}
