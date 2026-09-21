import { useState, type FormEvent } from "react";
import type { TaskItem, TasksSnapshot } from "@home-dash/shared";
import { useNow } from "../lib/useNow.js";
import { assigneeLabel, dueLabel } from "./tasks.js";
import type { WidgetProps } from "./types.js";

interface TasksOptions {
  /** A TickTick username. Shows only that person's tasks - a "my tasks" view. */
  assignee?: string;
  /** Hide quick-add, for a screen that should only display. */
  readOnly?: boolean;
}

/**
 * How long a ticked task waits before it is really completed. A wall panel
 * gets brushed past; this is the window to take a stray tap back.
 */
const UNDO_MS = 4000;

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function Check() {
  return (
    <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
      <path d="M4 10.5 8.2 14.5 16 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TasksWidget({ instance, config, envelope }: WidgetProps<TasksSnapshot>) {
  const now = useNow();
  /** Ticked, waiting out the undo window: task id -> timer. */
  const [finishing, setFinishing] = useState<Record<string, number>>({});
  /** Completed on the server, hidden until the next update drops them. */
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = envelope?.data;
  if (!data) return null;

  const options = instance.options as TasksOptions;
  const { timezone } = config.location;

  const forget = (id: string) =>
    setFinishing(({ [id]: _dropped, ...rest }) => rest);

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

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await post("/api/tasks", { title });
      if (!response.ok) throw new Error(String(response.status));
      setDraft("");
      setAdding(false);
    } catch {
      setError("Couldn't add that task. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const visible = data.tasks.filter(
    (task) => !done.has(task.id) && (!options.assignee || task.assigneeId === options.assignee),
  );

  return (
    <div className="tasks">
      {visible.length === 0 ? (
        <p className="tasks__empty">{options.assignee ? "Nothing assigned to you." : "All clear."}</p>
      ) : (
        <ul className="tasks__list">
          {visible.map((task) => {
            const pending = task.id in finishing;
            const due = dueLabel(task, now, timezone, config.units.clock);
            // In a "my tasks" view every task is yours, so the name is noise.
            const who = options.assignee ? null : assigneeLabel(task);

            return (
              <li
                className="task"
                key={task.id}
                data-finishing={pending}
                data-priority={task.priority === 5 ? "high" : undefined}
              >
                <button
                  type="button"
                  className="task__check"
                  onClick={() => (pending ? undo(task.id) : finish(task))}
                  aria-pressed={pending}
                  aria-label={pending ? `Undo completing ${task.title}` : `Mark ${task.title} done`}
                >
                  <span className="task__box">{pending && <Check />}</span>
                </button>

                <div className="task__body">
                  <span className="task__title">{task.title}</span>
                  {pending ? (
                    <span className="task__meta">
                      <button type="button" className="task__undo" onClick={() => undo(task.id)}>
                        Undo
                      </button>
                    </span>
                  ) : (
                    (due || who) && (
                      <span className="task__meta">
                        {due && (
                          <span className="task__due" data-tone={due.tone}>
                            {due.text}
                          </span>
                        )}
                        {who && <span className="task__who">{who}</span>}
                      </span>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="tasks__error" role="alert">
          {error}
        </p>
      )}

      {!options.readOnly &&
        (adding ? (
          <form className="tasks__form" onSubmit={add}>
            <input
              className="tasks__input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="New task"
              aria-label={`New task for ${data.listName}`}
              enterKeyHint="done"
              autoFocus
              maxLength={500}
            />
            <button type="submit" className="tasks__submit" disabled={busy || !draft.trim()}>
              Add
            </button>
            <button
              type="button"
              className="tasks__cancel"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="tasks__add" onClick={() => setAdding(true)}>
            Add a task
          </button>
        ))}
    </div>
  );
}
