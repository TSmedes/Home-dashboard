import type { MouseEvent } from "react";
import { GRID_COLUMNS, type DashboardConfig, type WidgetInstance } from "@home-dash/shared";
import type { WidgetEnvelope } from "@home-dash/shared";
import { useNow } from "../lib/useNow.js";
import { widgetFor } from "../widgets/registry.js";
import { OWN_CONTROLS, useExpand } from "./Expanded.js";
import { layout } from "./layout.js";
import { expandable, WidgetTile } from "./WidgetTile.js";

interface Props {
  config: DashboardConfig;
  /** One page's widgets, switched on or off. */
  widgets: WidgetInstance[];
  envelopes: Record<string, WidgetEnvelope<unknown>>;
  availableSources: string[];
}

export function DashboardGrid({ config, widgets, envelopes, availableSources }: Props) {
  // The minute tick is what puts bin day back on the wall at midnight without
  // anyone reloading the page.
  const now = useNow(60_000);
  const showing = (instance: WidgetInstance) =>
    instance.enabled && (widgetFor(instance.type)?.relevant?.({ instance, config, now }) ?? true);
  const { rows, cells } = layout(widgets, showing);
  const { expand } = useExpand();

  const expandFrom = (instance: WidgetInstance, from: HTMLElement) => {
    const cell = from.closest<HTMLElement>(".grid__cell");
    if (cell) expand(instance.id, cell);
  };

  // A tap anywhere on the tile opens it, except on a control the tile already
  // answers to. Safari sends no click after a swipe, so paging is unaffected.
  const onCellClick = (instance: WidgetInstance) => (event: MouseEvent<HTMLElement>) => {
    if (!expandable(instance, availableSources)) return;
    if ((event.target as Element).closest(OWN_CONTROLS)) return;
    expandFrom(instance, event.currentTarget);
  };

  const render = (instance: WidgetInstance) => (
    <WidgetTile
      instance={instance}
      config={config}
      envelopes={envelopes}
      availableSources={availableSources}
      onExpand={expandable(instance, availableSources) ? (from) => expandFrom(instance, from) : undefined}
    />
  );

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {cells.map((cell) => {
        if (cell.kind === "widget") {
          return (
            <div
              key={cell.key}
              className="grid__cell"
              style={{ gridColumn: cell.column, gridRow: cell.row }}
              onClick={onCellClick(cell.widget)}
            >
              {render(cell.widget)}
            </div>
          );
        }
        // A shared row spans the full width and its widgets split it evenly; a
        // stack keeps its own rectangle and they split it top to bottom.
        const band = cell.kind === "band";
        return (
          <div
            key={cell.key}
            className={band ? "grid__band" : "grid__stack"}
            style={{ gridColumn: band ? "1 / -1" : cell.column, gridRow: cell.row }}
          >
            {cell.widgets.map((widget) => (
              <div key={widget.id} className="grid__cell" onClick={onCellClick(widget)}>
                {render(widget)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
