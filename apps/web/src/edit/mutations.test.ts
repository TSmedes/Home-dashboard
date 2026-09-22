import { describe, expect, it } from "vitest";
import { GridPlacementSchema, type WidgetInstance } from "@home-dash/shared";
import { groupWidgets } from "../components/layout.js";
import {
  addWidget,
  canCreateBand,
  canCreateStack,
  canJoinStack,
  createBand,
  createStack,
  joinBand,
  joinStack,
  leaveBand,
  leaveStack,
  moveToPage,
  nextPageNumber,
  normaliseStack,
  onPage,
  placeWidget,
  removePage,
  removeWidget,
  reorder,
  swapBlocks,
  uniqueStackName,
  uniqueWidgetId,
} from "./mutations.js";

const widget = (id: string, grid: Partial<WidgetInstance["grid"]>, page = 1): WidgetInstance => ({
  id,
  type: id,
  enabled: true,
  page,
  options: {},
  grid: { row: 1, colSpan: 1, rowSpan: 1, share: false, ...grid },
});

const grid = (widgets: WidgetInstance[], id: string) => widgets.find((w) => w.id === id)!.grid;
const ids = (widgets: WidgetInstance[]) => widgets.map((w) => w.id);

/**
 * Every mutation must leave placements the server would accept. Parsing with
 * the real schema catches "col is required unless share is true" and the
 * twelve-column overflow without having to restate either rule here.
 */
const valid = (widgets: WidgetInstance[]) => {
  for (const w of widgets) expect(() => GridPlacementSchema.parse(w.grid), w.id).not.toThrow();
  return widgets;
};

/** Page 1 of the shipped day profile, which tiles the grid exactly. */
const day = [
  widget("clock", { col: 1, row: 1, colSpan: 4, rowSpan: 2 }),
  widget("weather", { col: 5, row: 1, colSpan: 8, rowSpan: 2 }),
  widget("agenda", { col: 1, row: 3, colSpan: 5, rowSpan: 4 }),
  widget("todo", { col: 6, row: 3, colSpan: 4, rowSpan: 4 }),
  widget("lights", { col: 10, row: 3, colSpan: 3, rowSpan: 4 }),
];

/** A big clock over a shared bottom row. */
const night = [
  widget("clock", { col: 1, row: 1, colSpan: 12, rowSpan: 4 }),
  widget("weather", { row: 5, rowSpan: 2, share: true }),
  widget("agenda", { row: 5, rowSpan: 2, share: true }),
];

/** A right-hand column of two, beside something wide. */
const column = [
  widget("river", { col: 1, row: 1, colSpan: 9, rowSpan: 6 }),
  widget("lights", { col: 10, row: 1, colSpan: 3, rowSpan: 2, stack: "right" }),
  widget("bins", { col: 10, row: 3, colSpan: 3, rowSpan: 4, stack: "right" }),
];

describe("naming", () => {
  it("uses the widget's type as its id when nothing has claimed it", () => {
    expect(uniqueWidgetId(day, "river")).toBe("river");
  });

  it("numbers a second one of the same type", () => {
    expect(uniqueWidgetId(day, "clock")).toBe("clock-2");
    expect(uniqueWidgetId([...day, widget("clock-2", { col: 1, row: 8 })], "clock")).toBe("clock-3");
  });

  it("names a stack after the widget it starts with", () => {
    expect(uniqueStackName(day, "lights")).toBe("lights-stack");
    expect(uniqueStackName(column, "lights")).toBe("lights-stack");
  });

  it("numbers a stack whose name is taken", () => {
    const taken = [widget("a", { col: 1, row: 1, stack: "lights-stack" })];
    expect(uniqueStackName(taken, "lights")).toBe("lights-stack-2");
  });

  it("gives a new page the number after the last", () => {
    expect(nextPageNumber(day)).toBe(2);
    expect(nextPageNumber([...day, widget("river", { col: 1, row: 1 }, 5)])).toBe(6);
  });
});

describe("placeWidget", () => {
  it("moves and resizes in one edit", () => {
    const next = valid(placeWidget(day, "clock", { col: 3, row: 5, colSpan: 2, rowSpan: 1 }));
    expect(grid(next, "clock")).toMatchObject({ col: 3, row: 5, colSpan: 2, rowSpan: 1 });
  });

  it("leaves the order alone", () => {
    expect(ids(placeWidget(day, "lights", { col: 1, row: 1, colSpan: 1, rowSpan: 1 }))).toEqual(ids(day));
  });
});

describe("swapBlocks", () => {
  it("trades two widgets' places", () => {
    const pair = [
      widget("a", { col: 1, row: 1, colSpan: 6, rowSpan: 2 }),
      widget("b", { col: 7, row: 1, colSpan: 6, rowSpan: 2 }),
    ];
    const next = valid(swapBlocks(pair, 1, "a", "b"));
    expect(grid(next, "a")).toMatchObject({ col: 7 });
    expect(grid(next, "b")).toMatchObject({ col: 1 });
  });

  it("moves a stack as one, keeping what is inside it in order", () => {
    const pair = [
      widget("wide", { col: 1, row: 1, colSpan: 3, rowSpan: 6 }),
      widget("lights", { col: 10, row: 1, colSpan: 3, rowSpan: 2, stack: "right" }),
      widget("bins", { col: 10, row: 3, colSpan: 3, rowSpan: 4, stack: "right" }),
    ];
    const next = valid(swapBlocks(pair, 1, "wide", "stack right"));
    expect(grid(next, "wide")).toMatchObject({ col: 10 });
    // The column slid left but lights is still above bins.
    expect(grid(next, "lights")).toMatchObject({ col: 1, row: 1 });
    expect(grid(next, "bins")).toMatchObject({ col: 1, row: 3 });
  });

  it("only moves a band's rows, because its members have no column", () => {
    const pair = [
      widget("clock", { col: 1, row: 1, colSpan: 12, rowSpan: 2 }),
      widget("a", { row: 3, rowSpan: 2, share: true }),
      widget("b", { row: 3, rowSpan: 2, share: true }),
    ];
    const next = valid(swapBlocks(pair, 1, "clock", "band 3 / span 2"));
    expect(grid(next, "clock")).toMatchObject({ col: 1, row: 3 });
    expect(grid(next, "a")).toMatchObject({ row: 1 });
    expect(grid(next, "a").col).toBeUndefined();
  });
});

describe("bands", () => {
  it("refuses to make a band out of one widget", () => {
    expect(canCreateBand(day, ["clock"])).toBe(false);
  });

  it("refuses when something else is on those rows", () => {
    // agenda and todo share rows 3-6, but lights is there too.
    expect(canCreateBand(day, ["agenda", "todo"])).toBe(false);
  });

  it("allows it once the rows are clear", () => {
    expect(canCreateBand(day, ["agenda", "todo", "lights"])).toBe(true);
  });

  it("takes the column off each member and gives them the union's rows", () => {
    const next = valid(createBand(day, ["agenda", "todo", "lights"]));
    for (const id of ["agenda", "todo", "lights"]) {
      expect(grid(next, id)).toMatchObject({ row: 3, rowSpan: 4, share: true });
      expect(grid(next, id).col, id).toBeUndefined();
    }
  });

  it("leaves a refused band exactly as it was", () => {
    expect(createBand(day, ["agenda", "todo"])).toEqual(day);
  });

  it("puts a joiner last in the band", () => {
    const next = valid(joinBand([...night, widget("todo", { col: 1, row: 7 })], "todo", "band 5 / span 2"));
    const band = groupWidgets(onPage(next, 1)).find((g) => g.kind === "band")!;
    expect(band.members.map((w) => w.id)).toEqual(["weather", "agenda", "todo"]);
    expect(grid(next, "todo")).toMatchObject({ row: 5, rowSpan: 2, share: true });
  });

  it("gives the last member out its old rows, because the band is gone", () => {
    const alone = [night[0]!, widget("weather", { row: 5, rowSpan: 2, colSpan: 4, share: true })];
    const next = valid(leaveBand(alone, "weather"));
    expect(grid(next, "weather")).toMatchObject({ col: 1, row: 5, rowSpan: 2, share: false });
  });

  it("moves a leaver off rows the rest of the band still covers", () => {
    // A band takes the full width of its rows however few are left in it, so
    // there is genuinely nowhere on rows 5-6 for the one stepping out.
    const next = valid(leaveBand([...night, widget("todo", { row: 5, rowSpan: 2, share: true })], "todo"));
    expect(grid(next, "todo")).toMatchObject({ col: 1, row: 7, share: false });
  });

  it("sends a leaver elsewhere when the band has claimed the whole row", () => {
    // Widening the leaver past what is free forces it off those rows.
    const wide = [...night.slice(0, 1), widget("weather", { row: 5, rowSpan: 2, share: true }), widget("agenda", { row: 5, rowSpan: 2, colSpan: 12, share: true })];
    const next = valid(leaveBand(wide, "agenda"));
    expect(grid(next, "agenda")).toMatchObject({ share: false, colSpan: 12 });
    expect(grid(next, "agenda").row).toBeGreaterThan(6);
  });

  it("does nothing to a widget that is not in a band", () => {
    expect(leaveBand(day, "clock")).toEqual(day);
  });
});

describe("stacks", () => {
  it("refuses a stack when something else sits in the column", () => {
    // clock and agenda are in column 1, but weather and todo overlap the union.
    expect(canCreateStack(day, ["clock", "agenda"])).toBe(false);
  });

  it("allows a stack whose members already form a clear column", () => {
    const stackable = [
      widget("wide", { col: 1, row: 1, colSpan: 9, rowSpan: 6 }),
      widget("a", { col: 10, row: 1, colSpan: 3, rowSpan: 2 }),
      widget("b", { col: 10, row: 3, colSpan: 3, rowSpan: 4 }),
    ];
    expect(canCreateStack(stackable, ["a", "b"])).toBe(true);
    const next = valid(createStack(stackable, ["a", "b"]));
    expect(grid(next, "a")).toMatchObject({ stack: "a-stack", col: 10, row: 1 });
    expect(grid(next, "b")).toMatchObject({ stack: "a-stack", col: 10, row: 3 });
  });

  it("lets a widget drop into a stack when the rows below are free", () => {
    const withRoom = [...column.slice(1), widget("spare", { col: 1, row: 7, colSpan: 3, rowSpan: 2 })];
    expect(canJoinStack(withRoom, "spare", "right")).toBe(true);
    const next = valid(joinStack(withRoom, "spare", "right"));
    expect(grid(next, "spare")).toMatchObject({ stack: "right", col: 10, colSpan: 3, row: 7 });
  });

  it("refuses to join when the rows below are taken", () => {
    const blocked = [
      ...column,
      widget("busy", { col: 10, row: 7, colSpan: 3, rowSpan: 2 }),
      widget("joiner", { col: 1, row: 7, colSpan: 3, rowSpan: 2 }),
    ];
    expect(canJoinStack(blocked, "joiner", "right")).toBe(false);
    expect(joinStack(blocked, "joiner", "right")).toEqual(blocked);
  });

  it("lets a widget already sitting under a stack drop into it", () => {
    const below = [...column, widget("busy", { col: 10, row: 7, colSpan: 3, rowSpan: 2 })];
    expect(canJoinStack(below, "busy", "right")).toBe(true);
  });

  it("gives a leaver the rectangle it was already showing at", () => {
    const next = valid(leaveStack(column, "bins"));
    expect(grid(next, "bins")).toMatchObject({ col: 10, colSpan: 3, row: 3, rowSpan: 4 });
    expect(grid(next, "bins").stack).toBeUndefined();
  });

  it("does not close up behind a leaver, which is still sitting there", () => {
    const three = [...column, widget("extra", { col: 10, row: 7, colSpan: 3, rowSpan: 2, stack: "right" })];
    const next = valid(leaveStack(three, "lights"));
    // lights keeps rows 1-2 as a fixed tile, so the column starts below it.
    expect(grid(next, "lights")).toMatchObject({ col: 10, row: 1, rowSpan: 2 });
    expect(grid(next, "bins")).toMatchObject({ row: 3 });
    expect(grid(next, "extra")).toMatchObject({ row: 7 });
  });

  it("lays members out in the order they are written", () => {
    const jumbled = [
      widget("a", { col: 10, row: 40, colSpan: 3, rowSpan: 2, stack: "right" }),
      widget("b", { col: 11, row: 3, colSpan: 2, rowSpan: 4, stack: "right" }),
    ];
    const next = valid(normaliseStack(jumbled, "right"));
    expect(grid(next, "a")).toMatchObject({ col: 10, colSpan: 3, row: 3, rowSpan: 2 });
    expect(grid(next, "b")).toMatchObject({ col: 10, colSpan: 3, row: 5, rowSpan: 4 });
  });

  it("is unchanged by running twice", () => {
    const once = normaliseStack(column, "right");
    expect(normaliseStack(once, "right")).toEqual(once);
  });

  it("leaves a stack that no longer exists alone", () => {
    expect(normaliseStack(day, "right")).toEqual(day);
  });
});

describe("reorder", () => {
  it("moves a band member along", () => {
    const next = valid(reorder(night, "agenda", -1));
    const band = groupWidgets(onPage(next, 1)).find((g) => g.kind === "band")!;
    expect(band.members.map((w) => w.id)).toEqual(["agenda", "weather"]);
  });

  it("moves a stack member and takes its rows with it", () => {
    const next = valid(reorder(column, "bins", -1));
    expect(ids(next)).toEqual(["river", "bins", "lights"]);
    expect(grid(next, "bins")).toMatchObject({ row: 1, rowSpan: 4 });
    expect(grid(next, "lights")).toMatchObject({ row: 5, rowSpan: 2 });
  });

  it("stops at the ends of the group", () => {
    expect(reorder(night, "weather", -1)).toEqual(night);
    expect(reorder(night, "agenda", 1)).toEqual(night);
  });

  it("does nothing for a widget in no group", () => {
    expect(reorder(day, "clock", 1)).toEqual(day);
  });
});

describe("adding, removing and pages", () => {
  it("puts a new widget where there is room", () => {
    const sparse = [widget("clock", { col: 1, row: 1, colSpan: 4, rowSpan: 2 })];
    const next = valid(addWidget(sparse, "weather", 1));
    expect(next.at(-1)).toMatchObject({ id: "weather", type: "weather", page: 1, enabled: true });
    expect(next.at(-1)!.grid).toMatchObject({ col: 5, row: 1, colSpan: 4, rowSpan: 2 });
  });

  it("adds a row below when the page is full", () => {
    const next = valid(addWidget(day, "river", 1));
    expect(next.at(-1)!.grid).toMatchObject({ col: 1, row: 7 });
  });

  it("only looks at the page it is adding to", () => {
    const next = valid(addWidget(day, "river", 2));
    // An empty page is one row tall, but it grows to hold what is put on it.
    expect(next.at(-1)).toMatchObject({ page: 2 });
    expect(next.at(-1)!.grid).toMatchObject({ col: 1, row: 1, colSpan: 4, rowSpan: 2 });
  });

  it("closes a stack up when one of its members is removed", () => {
    const next = valid(removeWidget(column, "lights"));
    expect(ids(next)).toEqual(["river", "bins"]);
    expect(grid(next, "bins")).toMatchObject({ row: 1 });
  });

  it("moves a widget to another page and finds it room there", () => {
    const two = [...day, widget("river", { col: 1, row: 1, colSpan: 6, rowSpan: 3 }, 2)];
    const next = valid(moveToPage(two, "clock", 2));
    expect(next.find((w) => w.id === "clock")).toMatchObject({ page: 2 });
    expect(grid(next, "clock")).toMatchObject({ col: 7, row: 1, colSpan: 4, rowSpan: 2 });
  });

  it("leaves a group behind when it changes page", () => {
    const two = [...column, widget("spare", { col: 1, row: 1 }, 2)];
    const next = valid(moveToPage(two, "bins", 2));
    expect(grid(next, "bins").stack).toBeUndefined();
    // The column that is left closes up.
    expect(grid(next, "lights")).toMatchObject({ row: 1 });
  });

  it("takes a page and everything on it away", () => {
    const two = [...day, widget("river", { col: 1, row: 1 }, 2)];
    expect(ids(removePage(two, 2))).toEqual(ids(day));
  });

  it("refuses to remove the only page, leaving nothing to show", () => {
    expect(removePage(day, 1)).toEqual(day);
  });
});
