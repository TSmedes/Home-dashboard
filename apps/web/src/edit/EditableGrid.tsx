import { GRID_COLUMNS, type DashboardConfig, type WidgetEnvelope, type WidgetInstance } from "@home-dash/shared";
import { layout } from "../components/layout.js";
import { WidgetTile } from "../components/WidgetTile.js";
import { WIDGET_NAMES } from "../widgets/names.js";
import { rowsOf } from "./grid.js";

interface Props {
  config: DashboardConfig;
  /** One page's widgets. */
  widgets: WidgetInstance[];
  envelopes: Record<string, WidgetEnvelope<unknown>>;
  availableSources: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/** Everything is on screen while editing, including what is switched off. */
const all = () => true;

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
 * And the grid is as tall as the page needs, not as tall as the screen: a
 * widget dragged onto a new row at the bottom has somewhere to land.
 */
export function EditableGrid({ config, widgets, envelopes, availableSources, selected, onSelect }: Props) {
  const { cells } = layout(widgets, all);
  const rows = rowsOf(widgets);

  const tile = (widget: WidgetInstance) => (
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
    </>
  );

  const cell = (widget: WidgetInstance, style?: React.CSSProperties) => (
    <div
      key={widget.id}
      className="grid__cell edit-tile"
      data-selected={selected === widget.id ? "" : undefined}
      data-off={widget.enabled ? undefined : ""}
      style={style}
    >
      {tile(widget)}
    </div>
  );

  return (
    <div
      className="grid edit-grid"
      style={{
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
      // A tap on bare grid clears the selection, which is how you put the
      // toolbar away without having to find a close button.
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelect(null);
      }}
    >
      {cells.map((item) => {
        if (item.kind === "widget") {
          return cell(item.widget, { gridColumn: item.column, gridRow: item.row });
        }
        const band = item.kind === "band";
        return (
          <div
            key={item.key}
            className={band ? "grid__band edit-group" : "grid__stack edit-group"}
            data-group={band ? "band" : "stack"}
            style={{ gridColumn: band ? "1 / -1" : item.column, gridRow: item.row }}
          >
            {item.widgets.map((widget) => cell(widget))}
          </div>
        );
      })}
    </div>
  );
}
