import type { WidgetInstance } from "@home-dash/shared";

export interface Page {
  /** The `page` number from config.yaml. Not necessarily its position. */
  number: number;
  /** Every widget on it, switched on or off, in config order. */
  widgets: WidgetInstance[];
}

/**
 * A profile's widgets split into its pages, in page-number order. Gaps in the
 * numbering are fine: pages 1 and 3 are simply the first and second page.
 */
export function pagesOf(widgets: WidgetInstance[]): Page[] {
  const byNumber = new Map<number, WidgetInstance[]>();
  for (const widget of widgets) {
    const list = byNumber.get(widget.page);
    if (list) list.push(widget);
    else byNumber.set(widget.page, [widget]);
  }
  return [...byNumber.entries()].sort(([a], [b]) => a - b).map(([number, list]) => ({ number, widgets: list }));
}

/**
 * The pages to swipe between. A page whose widgets are all switched off is
 * left out rather than shown blank, and a profile with nothing on it still
 * gets one page, so the screen is never zero pages wide.
 */
export function visiblePages(widgets: WidgetInstance[]): Page[] {
  const pages = pagesOf(widgets).filter((page) => page.widgets.some((w) => w.enabled));
  return pages.length > 0 ? pages : [{ number: 1, widgets: [] }];
}
