import { describe, expect, it } from "vitest";
import type { WidgetInstance } from "@home-dash/shared";
import { pagesOf, visiblePages } from "./pages.js";

const widget = (id: string, page: number, enabled = true): WidgetInstance => ({
  id,
  type: "clock",
  enabled,
  page,
  grid: { col: 1, row: 1, colSpan: 1, rowSpan: 1, share: false },
  options: {},
});

describe("pagesOf", () => {
  it("groups widgets by page number, in page order, keeping config order within a page", () => {
    const pages = pagesOf([widget("a", 2), widget("b", 1), widget("c", 2)]);
    expect(pages.map((p) => [p.number, p.widgets.map((w) => w.id)])).toEqual([
      [1, ["b"]],
      [2, ["a", "c"]],
    ]);
  });

  it("allows gaps in the numbering", () => {
    expect(pagesOf([widget("a", 3), widget("b", 1)]).map((p) => p.number)).toEqual([1, 3]);
  });

  it("puts everything on one page for a config written before pages existed", () => {
    expect(pagesOf([widget("a", 1), widget("b", 1)])).toHaveLength(1);
  });
});

describe("visiblePages", () => {
  it("leaves out a page whose widgets are all switched off", () => {
    const pages = visiblePages([widget("a", 1), widget("b", 2, false)]);
    expect(pages.map((p) => p.number)).toEqual([1]);
  });

  it("keeps switched-off widgets on a visible page, so the layout keeps its shape", () => {
    const pages = visiblePages([widget("a", 1), widget("b", 1, false)]);
    expect(pages[0]!.widgets.map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("always gives at least one page", () => {
    expect(visiblePages([])).toEqual([{ number: 1, widgets: [] }]);
    expect(visiblePages([widget("a", 2, false)])).toEqual([{ number: 1, widgets: [] }]);
  });
});
