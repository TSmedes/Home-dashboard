import type { WidgetInstance } from "@home-dash/shared";
import { groupWidgets } from "../components/layout.js";
import { WIDGET_NAMES } from "../widgets/names.js";
import {
  createBand,
  createStack,
  groupsFor,
  joinBand,
  joinStack,
  leaveBand,
  leaveStack,
  onPage,
  partnersFor,
  reorder,
} from "./mutations.js";

interface Props {
  /** The whole profile's widgets: grouping is per page, but the list is not. */
  widgets: WidgetInstance[];
  selected: WidgetInstance;
  onChange: (change: (widgets: WidgetInstance[]) => WidgetInstance[]) => void;
}

const nameOf = (widget: WidgetInstance) => widget.title || WIDGET_NAMES[widget.type] || widget.type;

/**
 * Putting a tile into a row or a column with others, and taking it out again.
 *
 * Two widgets can share the full width of a row, or share one column top to
 * bottom. Both exist so that switching one off gives its space to the rest
 * instead of leaving a hole - which is why they are worth being able to make
 * from the wall rather than only in the file.
 *
 * Everything here is offered from one tile's point of view, because that is
 * what is selected: join a group that exists, or pair up with a tile already
 * lined up with this one. Starting a group needs the two to be exactly aligned
 * - the same rows for a row, the same columns for a column - because anything
 * looser would have to move the other tile to make it fit, and "share this row
 * with that one" should not rearrange the page.
 */
export function EditGrouping({ widgets, selected, onChange }: Props) {
  const group = groupWidgets(onPage(widgets, selected.page)).find((g) =>
    g.kind !== "widget" && g.members.some((w) => w.id === selected.id),
  );

  if (group) {
    const band = group.kind === "band";
    const order = group.members.map((w) => w.id);
    const at = order.indexOf(selected.id);

    return (
      <div className="edit-group-controls" role="group" aria-label={band ? "Shared row" : "Shared column"}>
        <span className="edit-stepper__label">
          {band ? "Sharing a row" : "Sharing a column"} with {order.length - 1} other
          {order.length === 2 ? "" : "s"}
        </span>
        <button
          type="button"
          className="edit-chip"
          aria-label={band ? "Move left" : "Move up"}
          disabled={at === 0}
          onClick={() => onChange((list) => reorder(list, selected.id, -1))}
        >
          {band ? "◀" : "▲"}
        </button>
        <button
          type="button"
          className="edit-chip"
          aria-label={band ? "Move right" : "Move down"}
          disabled={at === order.length - 1}
          onClick={() => onChange((list) => reorder(list, selected.id, 1))}
        >
          {band ? "▶" : "▼"}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onChange((list) => (band ? leaveBand(list, selected.id) : leaveStack(list, selected.id)))}
        >
          {band ? "Take out of row" : "Take out of column"}
        </button>
      </div>
    );
  }

  const joinable = groupsFor(widgets, selected.id);
  const rowPartners = partnersFor(widgets, selected.id, "band");
  const columnPartners = partnersFor(widgets, selected.id, "stack");
  if (joinable.length === 0 && rowPartners.length === 0 && columnPartners.length === 0) return null;

  return (
    <div className="edit-group-controls" role="group" aria-label="Share space with another widget">
      {joinable.map((option) => (
        <button
          key={option.key}
          type="button"
          className="button"
          onClick={() =>
            onChange((list) =>
              option.kind === "band"
                ? joinBand(list, selected.id, option.key)
                : joinStack(list, selected.id, option.name),
            )
          }
        >
          Join {option.kind === "band" ? "row" : "column"} with {option.members.map(nameOf).join(", ")}
        </button>
      ))}
      {rowPartners.map((partner) => (
        <button
          key={`band-${partner.id}`}
          type="button"
          className="button"
          onClick={() => onChange((list) => createBand(list, [selected.id, partner.id]))}
        >
          Share row with {nameOf(partner)}
        </button>
      ))}
      {columnPartners.map((partner) => (
        <button
          key={`stack-${partner.id}`}
          type="button"
          className="button"
          onClick={() => onChange((list) => createStack(list, [selected.id, partner.id]))}
        >
          Share column with {nameOf(partner)}
        </button>
      ))}
    </div>
  );
}
