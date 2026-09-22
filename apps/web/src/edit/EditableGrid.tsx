import { useRef, type CSSProperties } from "react";
import { GRID_COLUMNS, type DashboardConfig, type WidgetEnvelope, type WidgetInstance } from "@home-dash/shared";
import { layout } from "../components/layout.js";
import { WidgetTile } from "../components/WidgetTile.js";
import { WIDGET_NAMES } from "../widgets/names.js";
import { rowsOf, type Drop, type Rect } from "./grid.js";
import { placeWidget, swapBlocks } from "./mutations.js";
import { useDrag } from "./useDrag.js";

interface Props {
  config: DashboardConfig;
  /** One page's widgets. */
  widgets: WidgetInstance[];
  page: number;
  envelopes: Record<string, WidgetEnvelope<unknown>>;
  availableSources: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (change: (widgets: WidgetInstance[]) => WidgetInstance[]) => void;
}

/** Everything is on screen while editing, including what is switched off. */
const all = () => true;

function Grip() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
      <circle cx="5" cy="3" r="1.4" />
      <circle cx="11" cy="3" r="1.4" />
      <circle cx="5" cy="8" r="1.4" />
      <circle cx="11" cy="8" r="1.4" />
      <circle cx="5" cy="13" r="1.4" />
      <circle cx="11" cy="13" r="1.4" />
    </svg>
  );
}

/**
 * The page being arranged.
 *
 * It draws the same tiles the dashboard does, on the same grid, so what you
 * arrange is what you will get. Three things are different.
 *
 * Every widget shows, including ones switched off and ones hiding themselves -
 * bin day is off the wall between collections. If they were missing you could
 * not move them, and worse, the space they hold would look empty.
 *
 * The tiles are inert. A light switch or a task checkbox under your finger
 * while you are rearranging the wall would be a nasty surprise, so the widget
 * itself takes no pointer events and the editing chrome sits over it.
 *
 * And a tile carries a drag handle. Only tiles with a place of their own do:
 * widgets sharing a row or a column are arranged by their order within the
 * group, which is a different question from where they sit.
 */
export function EditableGrid({
  config,
  widgets,
  page,
  envelopes,
  availableSources,
  selected,
  onSelect,
  onChange,
}: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const { cells } = layout(widgets, all);
  const rows = rowsOf(widgets);

  const onDrop = (id: string, rect: Rect, outcome: Drop) => {
    if (outcome.kind === "swap") {
      onChange((list) => swapBlocks(list, page, id, outcome.withKey));
      return;
    }
    onChange((list) => placeWidget(list, id, rect));
  };

  const { dragging, handleProps } = useDrag({ grid, widgets, onDrop });

  const tile = (widget: WidgetInstance, draggable: boolean) => (
    <>
      <div className="edit-tile__body" aria-hidden="true">
        <WidgetTile instance={widget} config={config} envelopes={envelopes} availableSources={availableSources} />
      </div>
      <button
        type="button"
        className="edit-tile__hit"
        aria-pressed={selected === widget.id}
        onClick={() => onSelect(selected === widget.id ? null : widget.id)}
      >
        <span className="edit-tile__name">{widget.title || WIDGET_NAMES[widget.type] || widget.type}</span>
        {!widget.enabled && <span className="edit-tile__off">Off</span>}
      </button>
      {draggable && (
        <button
          type="button"
          className="edit-tile__grip"
          aria-label={`Move ${widget.title || WIDGET_NAMES[widget.type] || widget.type}`}
          onPointerDown={handleProps.onPointerDown(widget)}
          onPointerMove={handleProps.onPointerMove}
          onPointerUp={handleProps.onPointerUp}
          onPointerCancel={handleProps.onPointerCancel}
        >
          <Grip />
        </button>
      )}
    </>
  );

  const cell = (widget: WidgetInstance, draggable: boolean, style?: CSSProperties) => (
    <div
      key={widget.id}
      className="grid__cell edit-tile"
      data-selected={selected === widget.id ? "" : undefined}
      data-off={widget.enabled ? undefined : ""}
      data-dragging={dragging?.id === widget.id ? "" : undefined}
      style={style}
    >
      {tile(widget, draggable)}
    </div>
  );

  return (
    <div
      ref={grid}
      className="grid edit-grid"
      style={{
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelect(null);
      }}
    >
      {cells.map((item) => {
        if (item.kind === "widget") {
          return cell(item.widget, true, { gridColumn: item.column, gridRow: item.row });
        }
        const band = item.kind === "band";
        return (
          <div
            key={item.key}
            className={band ? "grid__band edit-group" : "grid__stack edit-group"}
            data-group={band ? "band" : "stack"}
            style={{ gridColumn: band ? "1 / -1" : item.column, gridRow: item.row }}
          >
            {item.widgets.map((widget) => cell(widget, false))}
          </div>
        );
      })}

      {/* Where it would land. A grid child rather than an overlay, so the same
          twelve columns and the same gap place it exactly. */}
      {dragging && (
        <div
          className="edit-preview"
          data-drop={dragging.outcome.kind}
          style={{
            gridColumn: `${dragging.rect.col} / span ${dragging.rect.colSpan}`,
            gridRow: `${dragging.rect.row} / span ${dragging.rect.rowSpan}`,
          }}
        />
      )}
    </div>
  );
}
