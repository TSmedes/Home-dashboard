import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { editText, type ResolvedChange } from "./textEdits.js";

/**
 * A widget list written the way the shipped config writes one: prose comments
 * above entries, grids inline, a blank line between.
 */
const WIDGETS = `profiles:
  day:
    widgets:
      # The clock is the one thing that has to be readable from the hall.
      - id: clock
        type: clock
        grid: { col: 1, row: 1, colSpan: 4, rowSpan: 2 }

      # days is how many are listed one by one.
      - id: agenda
        type: calendar
        grid: { col: 5, row: 1, colSpan: 8, rowSpan: 2 }
        options: { days: 3 }

      - id: todo
        type: tasks
        grid: { col: 1, row: 3, colSpan: 12, rowSpan: 4 }
`;

const at = (...path: (string | number)[]) => path;
const edit = (src: string, changes: ResolvedChange[]) => editText(src, parseDocument(src), changes);
const comments = (src: string) => (src.match(/#/g) ?? []).length;

const widget = { id: "river", type: "river", grid: { col: 1, row: 7, colSpan: 4, rowSpan: 2 } };

describe("editText on a block list", () => {
  it("appends an entry past the end of the list", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 3), value: widget, op: "insert" }])!;
    expect(next).toContain("      - id: river\n");
    expect(parseDocument(next).toJS().profiles.day.widgets.map((w: { id: string }) => w.id)).toEqual([
      "clock",
      "agenda",
      "todo",
      "river",
    ]);
  });

  it("inserts an entry in the middle, pushing the rest along", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 1), value: widget, op: "insert" }])!;
    expect(parseDocument(next).toJS().profiles.day.widgets.map((w: { id: string }) => w.id)).toEqual([
      "clock",
      "river",
      "agenda",
      "todo",
    ]);
  });

  it("writes a nested map of plain values on one line, as the file does", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 3), value: widget, op: "insert" }])!;
    expect(next).toContain("grid: { col: 1, row: 7, colSpan: 4, rowSpan: 2 }");
  });

  it("indents a new entry to sit in its list", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 3), value: widget, op: "insert" }])!;
    for (const line of ["      - id: river", "        type: river"]) expect(next).toContain(line);
  });

  it("removes an entry without disturbing the others", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 1), value: null }])!;
    expect(parseDocument(next).toJS().profiles.day.widgets.map((w: { id: string }) => w.id)).toEqual(["clock", "todo"]);
    // The clock's comment and its entry are untouched.
    expect(next).toContain("# The clock is the one thing that has to be readable from the hall.");
  });

  it("takes the comment above a removed entry with it", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 1), value: null }])!;
    // That note explained the agenda; left behind it would read as the todo's.
    expect(next).not.toContain("days is how many");
    expect(comments(next)).toBe(comments(WIDGETS) - 1);
  });

  it("keeps the first entry's comment when the first entry goes", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 0), value: null }])!;
    expect(next).not.toContain("readable from the hall");
    expect(next).toContain("days is how many");
  });

  it("leaves every other character of the file alone", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 3), value: widget, op: "insert" }])!;
    // Everything that was there before is still there, in order.
    expect(next.startsWith(WIDGETS)).toBe(true);
  });

  it("keeps every comment when a widget is added", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 3), value: widget, op: "insert" }])!;
    expect(comments(next)).toBe(comments(WIDGETS));
  });

  it("mixes a move and an add in one surgical batch", () => {
    // The point of the primitive: a save that both moves and adds no longer
    // has to fall back to reprinting the whole file.
    const next = edit(WIDGETS, [
      { path: at("profiles", "day", "widgets", 0, "grid", "col"), value: 5 },
      { path: at("profiles", "day", "widgets", 3), value: widget, op: "insert" },
    ])!;
    expect(next).not.toBe(null);
    expect(next).toContain("grid: { col: 5, row: 1, colSpan: 4, rowSpan: 2 }");
    expect(comments(next)).toBe(comments(WIDGETS));
  });

  it("separates an appended entry the way the list separates its own", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 3), value: widget, op: "insert" }])!;
    expect(next).toContain("rowSpan: 4 }\n\n" + "      - id: river");
  });

  it("separates an inserted entry from the one it displaces", () => {
    const next = edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 1), value: widget, op: "insert" }])!;
    // And it goes above the displaced entry's comment, not between it and its entry.
    expect(next).toContain("      - id: river");
    const lines = next.split("\n");
    const river = lines.findIndex((l) => l.includes("- id: river"));
    const note = lines.findIndex((l) => l.includes("days is how many"));
    expect(river).toBeLessThan(note);
    expect(lines[river - 1]).toBe("");
  });

  it("follows a list that does not space its entries", () => {
    const tight = "a:\n  list:\n    - id: one\n      n: 1\n    - id: two\n      n: 2" + "\n";
    const next = edit(tight, [{ path: at("a", "list", 2), value: { id: "three", n: 3 }, op: "insert" }])!;
    expect(next).toBe(tight + "    - id: three\n      n: 3" + "\n");
  });

  it("refuses a list written on one line, leaving it to the reprint", () => {
    const flow = "river:\n  gauges: [ SNQW1, TANW1 ]\n";
    expect(edit(flow, [{ path: at("river", "gauges", 2), value: "GARW1", op: "insert" }])).toBe(null);
  });

  it("refuses rather than writing something that does not mean what was asked", () => {
    // The safety net: nothing is written unless the edited text reparses to
    // exactly the intended result.
    expect(edit(WIDGETS, [{ path: at("profiles", "day", "widgets", 9), value: null }])).toBe(null);
  });
});
