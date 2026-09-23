import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

/**
 * What edit mode actually sends, against the file a fresh install starts from.
 *
 * Any one change that cannot be written as text makes the whole save re-print,
 * which keeps every comment but reflows the ones that were aligned in columns.
 * That is a one-way loss of someone's formatting, so the shapes edit mode
 * produces are pinned here: each of these must stay surgical.
 */
describe("the shapes a save arrives in", async () => {
  const examplePath = fileURLToPath(new URL("../../../../config/config.example.yaml", import.meta.url));
  const src = await readFile(examplePath, "utf8");
  const day = (parseDocument(src).toJS() as { profiles: Record<string, { widgets: unknown[] }> }).profiles.day!
    .widgets.length;
  const grid = { col: 1, row: 7, colSpan: 4, rowSpan: 2 };
  const fresh = { id: "river-2", type: "river", page: 2, grid };

  const cases: [string, ResolvedChange[]][] = [
    ["a tile moved", [{ path: at("profiles", "day", "widgets", 0, "grid", "col"), value: 5 }]],
    ["a tile resized", [{ path: at("profiles", "day", "widgets", 1, "grid", "colSpan"), value: 3 }]],
    ["a tile switched off", [{ path: at("profiles", "day", "widgets", 0, "enabled"), value: false }]],
    ["a tile sent to another page", [{ path: at("profiles", "day", "widgets", 0, "page"), value: 2 }]],
    ["a widget removed", [{ path: at("profiles", "day", "widgets", day - 1), value: null }]],
    ["a widget added", [{ path: at("profiles", "day", "widgets", day), value: fresh, op: "insert" }]],
    [
      "a widget removed and another put in its place",
      [
        { path: at("profiles", "day", "widgets", day - 1), value: null },
        { path: at("profiles", "day", "widgets", day - 1), value: fresh, op: "insert" },
      ],
    ],
    [
      "the first option on a widget that had none",
      [{ path: at("profiles", "day", "widgets", 0, "options"), value: { showSeconds: true } }],
    ],
    ["another option on one that has some", [{ path: at("profiles", "day", "widgets", 2, "options", "compact"), value: true }]],
    ["the last option cleared", [{ path: at("profiles", "day", "widgets", 2, "options"), value: null }]],
    [
      "a whole session at once",
      [
        { path: at("profiles", "day", "widgets", 0, "grid", "col"), value: 5 },
        { path: at("profiles", "day", "widgets", 0, "options"), value: { showSeconds: true } },
        { path: at("profiles", "day", "widgets", 1, "grid", "colSpan"), value: 3 },
        { path: at("profiles", "day", "widgets", day - 1), value: null },
        { path: at("profiles", "day", "widgets", day - 1), value: fresh, op: "insert" },
      ],
    ],
  ];

  for (const [name, changes] of cases) {
    it(`edits the file in place for ${name}`, () => {
      expect(edit(src, changes), name).not.toBe(null);
    });
  }

  it("writes a widget's first option the way the file writes one", () => {
    const next = edit(src, [{ path: at("profiles", "day", "widgets", 0, "options"), value: { showSeconds: true } }])!;
    expect(next).toContain("options: { showSeconds: true }");
  });

  it("keeps the column a comment was aligned in", () => {
    const aligned = src.split("\n").filter((line) => /\S\s{2,}#/.test(line));
    expect(aligned.length).toBeGreaterThan(0);
    const next = edit(src, [{ path: at("profiles", "day", "widgets", 0, "grid", "col"), value: 5 }])!;
    for (const line of aligned) expect(next).toContain(line);
  });
});
