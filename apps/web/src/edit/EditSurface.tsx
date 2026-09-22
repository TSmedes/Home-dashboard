import { useEffect } from "react";
import { useDashboard } from "../lib/dashboard.js";
import { useEdit } from "./EditContext.js";
import { EditableGrid } from "./EditableGrid.js";
import { EditToolbar } from "./EditToolbar.js";
import { onPage } from "./mutations.js";

/**
 * The dashboard, being arranged.
 *
 * It replaces the pager rather than sitting over it. Swiping between pages is
 * off while editing - a drag across the screen has to mean moving a tile, not
 * turning the page - so the pages are buttons on the toolbar and the stage
 * below is one page at a time.
 */
export function EditSurface() {
  const { envelopes, availableSources } = useDashboard();
  const api = useEdit();
  const state = api.state;

  // Escape leaves, as it does everywhere else on the dashboard. It cancels
  // rather than saves: the destructive reading of an ambiguous key press is
  // the one to avoid, and there is a Save button two inches away.
  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") api.select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, api]);

  if (!state) return null;
  const profile = state.draft.profiles[state.profileName];
  if (!profile) return null;

  const widgets = onPage(profile.widgets, state.page);

  return (
    <div className="edit" role="region" aria-label="Editing the dashboard layout">
      <EditToolbar api={api} state={state} />
      <div className="edit__stage">
        {widgets.length === 0 ? (
          <p className="edit__empty">This page is empty. Add a widget to put something on it.</p>
        ) : (
          <EditableGrid
            config={state.draft}
            widgets={widgets}
            envelopes={envelopes}
            availableSources={availableSources}
            selected={state.selected}
            onSelect={api.select}
          />
        )}
      </div>
    </div>
  );
}
