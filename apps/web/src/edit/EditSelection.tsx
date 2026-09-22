import type { WidgetInstance } from "@home-dash/shared";
import { WIDGET_NAMES } from "../widgets/names.js";
import { blocksOf, clampResize, rowsOf } from "./grid.js";
import { placeWidget } from "./mutations.js";

interface Props {
  /** The page's widgets, which decide how far the selected one can grow. */
  widgets: WidgetInstance[];
  selected: WidgetInstance;
  onChange: (change: (widgets: WidgetInstance[]) => WidgetInstance[]) => void;
}

/** A pair of buttons around a number, sized for a finger. */
function Stepper({
  label,
  value,
  onStep,
  canShrink,
  canGrow,
}: {
  label: string;
  value: number;
  onStep: (delta: -1 | 1) => void;
  canShrink: boolean;
  canGrow: boolean;
}) {
  return (
    <div className="edit-stepper">
      <span className="edit-stepper__label">{label}</span>
      <button type="button" aria-label={`${label} smaller`} onClick={() => onStep(-1)} disabled={!canShrink}>
        &minus;
      </button>
      <span className="edit-stepper__value" aria-live="polite">
        {value}
      </span>
      <button type="button" aria-label={`${label} bigger`} onClick={() => onStep(1)} disabled={!canGrow}>
        +
      </button>
    </div>
  );
}

/**
 * What can be done to the tile you have picked.
 *
 * Resizing is buttons rather than a corner handle: it wants one cell at a
 * time and it is done rarely, and a corner handle on a 14px gap is the
 * hardest thing to hit on a touch screen. The buttons stop when the tile
 * reaches the edge of the grid or the first thing in its way, so what they
 * offer is always something that will happen.
 *
 * A widget sharing a row or a column has no size of its own - it takes a share
 * of the group's rectangle - so it says so instead of offering buttons that
 * would do nothing.
 */
export function EditSelection({ widgets, selected, onChange }: Props) {
  const name = selected.title || WIDGET_NAMES[selected.type] || selected.type;
  const grouped = selected.grid.share || selected.grid.stack !== undefined;

  const rect = {
    col: selected.grid.col ?? 1,
    row: selected.grid.row,
    colSpan: selected.grid.colSpan,
    rowSpan: selected.grid.rowSpan,
  };

  const resize = (axis: "colSpan" | "rowSpan") => (delta: -1 | 1) =>
    onChange((list) => {
      const next = clampResize(blocksOf(list), selected.id, rect, { [axis]: delta }, rowsOf(list));
      return placeWidget(list, selected.id, next);
    });

  // Ask the same function the button will use whether it would do anything,
  // so a button is never offered that quietly does nothing.
  const room = (axis: "colSpan" | "rowSpan", delta: -1 | 1) =>
    clampResize(blocksOf(widgets), selected.id, rect, { [axis]: delta }, rowsOf(widgets))[axis] !== rect[axis];

  return (
    <div className="edit-selection" role="group" aria-label={`Editing ${name}`}>
      <span className="edit-selection__name">{name}</span>

      {grouped ? (
        <p className="edit-selection__note">
          {selected.grid.share
            ? "Shares its row, so its width is whatever is left over."
            : "Shares a column, so its width comes from the column."}
        </p>
      ) : (
        <>
          <Stepper
            label="Width"
            value={rect.colSpan}
            onStep={resize("colSpan")}
            canShrink={rect.colSpan > 1}
            canGrow={room("colSpan", 1)}
          />
          <Stepper
            label="Height"
            value={rect.rowSpan}
            onStep={resize("rowSpan")}
            canShrink={rect.rowSpan > 1}
            canGrow={room("rowSpan", 1)}
          />
        </>
      )}
    </div>
  );
}
