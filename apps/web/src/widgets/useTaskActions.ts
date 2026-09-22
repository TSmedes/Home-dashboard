import { useState } from "react";
import type { TaskItem } from "@home-dash/shared";

/**
 * How long a ticked task waits before it is really completed. A wall panel
 * gets brushed past; this is the window to take a stray tap back.
 */
const UNDO_MS = 4000;

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/**
 * Ticking off and adding tasks, shared by the tile and its full-screen view.
 * Each keeps its own copy: a tick waiting out its undo window on the tile is
 * not carried into the expanded view, and completes on its own regardless.
 */
export function useTaskActions() {
  /** Ticked, waiting out the undo window: task id -> timer. */
  const [finishing, setFinishing] = useState<Record<string, number>>({});
  /** Completed on the server, hidden until the next update drops them. */
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forget = (id: string) => setFinishing(({ [id]: _dropped, ...rest }) => rest);

  const finish = (task: TaskItem) => {
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await post(`/api/tasks/${encodeURIComponent(task.id)}/complete`, {
          projectId: task.projectId,
        });
        if (!response.ok) throw new Error(String(response.status));
        setDone((prev) => new Set(prev).add(task.id));
      } catch {
        setError(`Couldn't mark “${task.title}” done. Try again.`);
      } finally {
        forget(task.id);
      }
    }, UNDO_MS);
    setFinishing((prev) => ({ ...prev, [task.id]: timer }));
  };

  const undo = (id: string) => {
    window.clearTimeout(finishing[id]);
    forget(id);
  };

  /** Resolves true once the task is in TickTick. */
  const add = async (title: string): Promise<boolean> => {
    if (!title || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const response = await post("/api/tasks", { title });
      if (!response.ok) throw new Error(String(response.status));
      return true;
    } catch {
      setError("Couldn't add that task. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { finishing, done, busy, error, finish, undo, add };
}
