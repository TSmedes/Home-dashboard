import { useEffect, useRef } from "react";
import { widgetRegistry } from "../widgets/registry.js";
import { WIDGET_NAMES } from "../widgets/names.js";

interface Props {
  availableSources: string[];
  /** Types already on this page, so a duplicate is at least a deliberate one. */
  onPage: string[];
  onPick: (type: string) => void;
  onClose: () => void;
}

/**
 * Everything the dashboard knows how to draw.
 *
 * The list comes from the widget registry rather than a list kept here, so a
 * new widget is still "a new file plus an entry in the registry" and shows up
 * to be added without anyone remembering to add it twice.
 *
 * A widget whose data source is not set up is still offered - it draws a tile
 * saying what it needs - but it says so first, so nobody adds the commute
 * widget and then wonders why it is blank.
 */
export function AddWidgetPicker({ availableSources, onPage, onPick, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const types = Object.keys(widgetRegistry).sort((a, b) =>
    (WIDGET_NAMES[a] ?? a).localeCompare(WIDGET_NAMES[b] ?? b),
  );

  return (
    <div className="edit-picker" role="dialog" aria-modal="true" aria-label="Add a widget">
      <div className="edit-picker__backdrop" onClick={onClose} />
      <div className="edit-picker__panel" ref={panel}>
        <header className="edit-picker__head">
          <h2 className="edit-picker__title">Add a widget</h2>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </header>
        <ul className="edit-picker__list">
          {types.map((type) => {
            const definition = widgetRegistry[type]!;
            const ready = !definition.dataKey || availableSources.includes(definition.dataKey);
            return (
              <li key={type}>
                <button type="button" className="edit-picker__item" onClick={() => onPick(type)}>
                  <span className="edit-picker__name">{WIDGET_NAMES[type] ?? type}</span>
                  {!ready && <span className="edit-picker__note">Needs setting up</span>}
                  {onPage.includes(type) && <span className="edit-picker__note">Already on this page</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
