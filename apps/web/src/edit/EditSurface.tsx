import { useEffect, useState } from "react";
import type { WidgetInstance } from "@home-dash/shared";
import { useDashboard } from "../lib/dashboard.js";
import { useEdit } from "./EditContext.js";
import { AddWidgetPicker } from "./AddWidgetPicker.js";
import { EditableGrid } from "./EditableGrid.js";
import { EditSelection } from "./EditSelection.js";
import { EditToolbar } from "./EditToolbar.js";
import { addWidget, nextPageNumber, onPage, pageNumbers, removePage } from "./mutations.js";

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
  const [adding, setAdding] = useState(false);

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
  const selected = widgets.find((w) => w.id === state.selected) ?? null;

  /**
   * The one way the page's widget list is changed. It reads the profile out of
   * the draft being updated rather than the one rendered, so two changes in
   * the same turn cannot undo each other.
   */
  const change = (recipe: (widgets: WidgetInstance[]) => WidgetInstance[]) =>
    api.update((draft) => {
      const current = draft.profiles[state.profileName];
      if (!current) return draft;
      return {
        ...draft,
        profiles: { ...draft.profiles, [state.profileName]: { ...current, widgets: recipe(current.widgets) } },
      };
    });

  return (
    <div className="edit" role="region" aria-label="Editing the dashboard layout">
      <EditToolbar
        api={api}
        state={state}
        onAdd={() => setAdding(true)}
        onAddPage={() => api.setPage(nextPageNumber(profile.widgets))}
        onRemovePage={() => {
          const others = pageNumbers(profile.widgets, state.page).filter((n) => n !== state.page);
          change((list) => removePage(list, state.page));
          if (others[0] !== undefined) api.setPage(others[0]);
        }}
      />
      <div className="edit__stage">
        {widgets.length === 0 ? (
          <p className="edit__empty">This page is empty. Add a widget to put something on it.</p>
        ) : (
          <EditableGrid
            config={state.draft}
            widgets={widgets}
            page={state.page}
            envelopes={envelopes}
            availableSources={availableSources}
            selected={state.selected}
            onSelect={api.select}
            onChange={change}
          />
        )}
      </div>
      {selected && (
        <EditSelection
          widgets={widgets}
          all={profile.widgets}
          selected={selected}
          pages={pageNumbers(profile.widgets, state.page)}
          onChange={change}
          onRemoved={() => api.select(null)}
        />
      )}
      {adding && (
        <AddWidgetPicker
          availableSources={availableSources}
          onPage={widgets.map((w) => w.type)}
          onClose={() => setAdding(false)}
          onPick={(type) => {
            change((list) => addWidget(list, type, state.page));
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
