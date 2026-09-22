import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DashboardConfigSchema, type DashboardConfig } from "@home-dash/shared";
import { reason, send } from "../lib/api.js";
import { useDashboard } from "../lib/dashboard.js";
import { configChanges } from "./diff.js";

/** How many steps back edit mode remembers. Snapshots are cheap; a wall is not a document. */
const HISTORY = 40;

export interface EditState {
  /** The config as it was when editing began. What Save is measured against. */
  base: DashboardConfig;
  /** The working copy. Every change replaces it outright. */
  draft: DashboardConfig;
  /**
   * Which profile is being laid out. Preview only: it never touches the
   * schedule, so arranging the night screen at two in the afternoon does not
   * put the night screen on the wall.
   */
  profileName: string;
  page: number;
  selected: string | null;
  history: DashboardConfig[];
}

export interface EditApi {
  state: EditState | null;
  /** Whether the dashboard is being edited rather than shown. */
  editing: boolean;
  /** Unsaved changes, as the count shown on the toolbar. */
  changeCount: number;
  /** What is wrong with the draft, if anything - Save stays disabled until it is not. */
  problem: string | null;
  saving: boolean;
  error: string | null;
  canUndo: boolean;
  begin: (profileName: string) => void;
  cancel: () => void;
  save: () => Promise<void>;
  update: (recipe: (draft: DashboardConfig) => DashboardConfig) => void;
  undo: () => void;
  select: (id: string | null) => void;
  setProfile: (name: string) => void;
  setPage: (page: number) => void;
}

const EditContext = createContext<EditApi | null>(null);

export function useEdit(): EditApi {
  const api = useContext(EditContext);
  if (!api) throw new Error("useEdit must be used inside an EditProvider");
  return api;
}

/**
 * Holds the dashboard being edited.
 *
 * Edit mode keeps its own copy of the whole config and changes only that;
 * nothing is written until Save. That is what makes trying an arrangement
 * free, and it is also why a `config-changed` arriving over the stream cannot
 * disturb the work: while editing, the screen renders the draft and never
 * looks at the config the provider is holding.
 *
 * The copy is the whole config rather than one profile because a widget's own
 * panel edits the settings it reads - the countdowns list, the commute
 * destinations - and those live outside the profile.
 */
export function EditProvider({ children }: { children: ReactNode }) {
  const { config } = useDashboard();
  const [state, setState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = useCallback(
    (profileName: string) => {
      if (!config) return;
      setError(null);
      setState({
        base: config,
        draft: config,
        profileName: config.profiles[profileName] ? profileName : (Object.keys(config.profiles)[0] ?? profileName),
        page: 1,
        selected: null,
        history: [],
      });
    },
    [config],
  );

  const update = useCallback((recipe: (draft: DashboardConfig) => DashboardConfig) => {
    setState((prev) => {
      if (!prev) return prev;
      const draft = recipe(prev.draft);
      // A mutation that refused - a drop onto something that will not move -
      // hands back the same list, and is not worth an undo step.
      if (draft === prev.draft) return prev;
      return { ...prev, draft, history: [...prev.history, prev.draft].slice(-HISTORY) };
    });
  }, []);

  const undo = useCallback(() => {
    setState((prev) => {
      const previous = prev?.history.at(-1);
      if (!prev || !previous) return prev;
      return { ...prev, draft: previous, history: prev.history.slice(0, -1) };
    });
  }, []);

  const cancel = useCallback(() => {
    setState(null);
    setError(null);
  }, []);

  const select = useCallback((id: string | null) => setState((prev) => (prev ? { ...prev, selected: id } : prev)), []);
  const setProfile = useCallback(
    (name: string) => setState((prev) => (prev ? { ...prev, profileName: name, page: 1, selected: null } : prev)),
    [],
  );
  const setPage = useCallback(
    (page: number) => setState((prev) => (prev ? { ...prev, page, selected: null } : prev)),
    [],
  );

  const changes = useMemo(() => (state ? configChanges(state.base, state.draft) : []), [state]);

  // Checked on every change, so an arrangement the server would refuse is
  // caught the moment it is made rather than as a failed save ten minutes on.
  const problem = useMemo(() => {
    if (!state) return null;
    const parsed = DashboardConfigSchema.safeParse(state.draft);
    if (parsed.success) return null;
    const issue = parsed.error.issues[0];
    return issue ? `${issue.path.join(".")}: ${issue.message}` : "That layout is not valid.";
  }, [state]);

  const save = useCallback(async () => {
    if (!state || problem) return;
    // Nothing to write, so leaving is the whole of it.
    if (changes.length === 0) {
      setState(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await send("PATCH", "/api/config", { changes });
      setState(null);
    } catch (cause) {
      // Stay in edit mode with the work intact; the message says what to fix.
      setError(reason(cause));
    } finally {
      setSaving(false);
    }
  }, [state, problem, changes]);

  const api = useMemo<EditApi>(
    () => ({
      state,
      editing: state !== null,
      changeCount: changes.length,
      problem,
      saving,
      error,
      canUndo: (state?.history.length ?? 0) > 0,
      begin,
      cancel,
      save,
      update,
      undo,
      select,
      setProfile,
      setPage,
    }),
    [state, changes.length, problem, saving, error, begin, cancel, save, update, undo, select, setProfile, setPage],
  );

  return <EditContext.Provider value={api}>{children}</EditContext.Provider>;
}
