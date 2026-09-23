import { useEffect, useState } from "react";
import type { DashboardConfig, WidgetInstance } from "@home-dash/shared";
import { reason, send } from "../lib/api.js";
import { useDashboard } from "../lib/dashboard.js";
import type { WidgetDefinition } from "../widgets/types.js";
import { configChanges } from "./diff.js";

interface Props {
  instance: WidgetInstance;
  definition: WidgetDefinition;
  /** Told when the sheet is open, so the view does not close itself mid-edit. */
  onBusy?: (busy: boolean) => void;
}

/**
 * The settings a widget reads, edited from the widget itself.
 *
 * Edit mode can do this too, but going through it to add one countdown is
 * three steps and a mode switch for something you are already looking at. So
 * the same editor opens straight from the full-screen view - and it is the
 * same component, not a second copy of the form.
 *
 * The difference is when it writes. Edit mode stages everything and saves on
 * Save; here each change goes at once, because there is no Save button to
 * press and nothing else to batch it with. The staged copy is kept anyway,
 * because a save in flight means the config from the server is a moment
 * behind, and a second edit made in that moment has to build on the first.
 */
export function LiveConfigEditor({ instance, definition, onBusy }: Props) {
  const { config } = useDashboard();
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<DashboardConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => onBusy?.(open), [open, onBusy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const Editor = definition.configEditor;
  if (!Editor || !config) return null;

  const current = local ?? config;

  const update = (recipe: (draft: DashboardConfig) => DashboardConfig) => {
    const next = recipe(current);
    const changes = configChanges(current, next);
    if (changes.length === 0) return;

    setLocal(next);
    setSaving(true);
    setError(null);
    send("PATCH", "/api/config", { changes })
      .then((saved) => setLocal((saved as { config: DashboardConfig }).config))
      .catch((cause) => {
        setError(reason(cause));
        // Back to what the server actually has, rather than showing a change
        // that did not happen.
        setLocal(null);
      })
      .finally(() => setSaving(false));
  };

  const close = () => {
    setOpen(false);
    setLocal(null);
    setError(null);
  };

  if (!open) {
    return (
      <button type="button" className="expanded__edit" onClick={() => setOpen(true)} data-no-expand>
        Edit
      </button>
    );
  }

  return (
    <div className="edit-picker" role="dialog" aria-modal="true" aria-label={`${instance.type} settings`}>
      <div className="edit-picker__backdrop" onClick={close} />
      <div className="edit-picker__panel edit-picker__panel--wide">
        <header className="edit-picker__head">
          <p className="edit-picker__saved" role="status">
            {error ? <span className="edit-bar__problem">Not saved: {error}</span> : saving ? "Saving" : "Saved"}
          </p>
          <button type="button" className="button button--primary" onClick={close}>
            Done
          </button>
        </header>
        <div className="edit-picker__scroll">
          <Editor instance={instance} config={current} update={update} />
        </div>
      </div>
    </div>
  );
}
