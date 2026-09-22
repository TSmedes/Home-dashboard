import { pagesOf } from "../components/pages.js";
import { profileLabel } from "../settings/model.js";
import type { EditApi, EditState } from "./EditContext.js";
import { onPage } from "./mutations.js";

/** The page numbers in a profile, in order, always including the one being shown. */
export function pageNumbers(state: EditState): number[] {
  const widgets = state.draft.profiles[state.profileName]?.widgets ?? [];
  const numbers = new Set(pagesOf(widgets).map((page) => page.number));
  numbers.add(state.page);
  return [...numbers].sort((a, b) => a - b);
}

/**
 * What edit mode is doing and how to leave it.
 *
 * The profile switcher is a preview: it changes which layout you are working
 * on, never which one the wall shows on schedule. Pages are buttons rather
 * than a swipe, because swiping is off while editing - a drag across the
 * screen has to mean moving a tile and nothing else.
 */
export function EditToolbar({ api, state, onAdd }: { api: EditApi; state: EditState; onAdd: () => void }) {
  const profiles = Object.keys(state.draft.profiles);
  const pages = pageNumbers(state);
  const unsaved = api.changeCount > 0;

  return (
    <header className="edit-bar">
      <div className="edit-bar__group" role="group" aria-label="Which layout to edit">
        {profiles.map((name) => (
          <button
            key={name}
            type="button"
            className="edit-chip"
            aria-pressed={name === state.profileName}
            onClick={() => api.setProfile(name)}
          >
            {profileLabel(name)}
          </button>
        ))}
      </div>

      <div className="edit-bar__group" role="group" aria-label="Page">
        {pages.map((number, index) => (
          <button
            key={number}
            type="button"
            className="edit-chip"
            aria-pressed={number === state.page}
            onClick={() => api.setPage(number)}
          >
            {index + 1}
            {onPage(state.draft.profiles[state.profileName]?.widgets ?? [], number).length === 0 && (
              <span className="edit-chip__note">empty</span>
            )}
          </button>
        ))}
      </div>

      <p className="edit-bar__status" role="status">
        {api.error ? (
          <span className="edit-bar__problem">Not saved: {api.error}</span>
        ) : api.problem ? (
          <span className="edit-bar__problem">{api.problem}</span>
        ) : unsaved ? (
          `${api.changeCount} unsaved change${api.changeCount === 1 ? "" : "s"}`
        ) : (
          "No changes yet"
        )}
      </p>

      <button type="button" className="button" onClick={onAdd}>
        Add widget
      </button>
      <button type="button" className="button" onClick={api.undo} disabled={!api.canUndo}>
        Undo
      </button>
      <button type="button" className="button" onClick={api.cancel}>
        Cancel
      </button>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void api.save()}
        disabled={api.saving || api.problem !== null}
      >
        {api.saving ? "Saving" : unsaved ? "Save" : "Done"}
      </button>
    </header>
  );
}
