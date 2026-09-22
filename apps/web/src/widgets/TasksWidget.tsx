import { useState, type FormEvent } from "react";
import type { TaskItem, TasksSnapshot } from "@home-dash/shared";
import { useNow } from "../lib/useNow.js";
import { assigneeLabel, dueLabel } from "./tasks.js";
import type { WidgetProps } from "./types.js";
import { useTaskActions } from "./useTaskActions.js";

interface TasksOptions {
  /** A TickTick username. Shows only that person's tasks - a "my tasks" view. */
  assignee?: string;
  /** Hide quick-add, for a screen that should only display. */
  readOnly?: boolean;
}

function Check() {
  return (
    <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
      <path d="M4 10.5 8.2 14.5 16 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** One task: the tick box, its title, and when it is due and whose it is. */
export function TaskRow({
  task,
  pending,
  now,
  timezone,
  clock,
  showAssignee,
  showTags = false,
  showNotes = false,
  onFinish,
  onUndo,
}: {
  task: TaskItem;
  pending: boolean;
  now: Date;
  timezone: string;
  clock: "12h" | "24h";
  showAssignee: boolean;
  showTags?: boolean;
  /** Show the task's notes under its title. Off on the tile, which has no room. */
  showNotes?: boolean;
  onFinish: () => void;
  onUndo: () => void;
}) {
  const due = dueLabel(task, now, timezone, clock);
  const who = showAssignee ? assigneeLabel(task) : null;
  const tags = showTags ? task.tags : [];
  // Notes are clamped to three lines so one long note cannot push every other
  // task off the screen; a tap gives the whole thing.
  const [notesOpen, setNotesOpen] = useState(false);
  const notes = showNotes ? task.notes : undefined;

  return (
    <li className="task" data-finishing={pending} data-priority={task.priority === 5 ? "high" : undefined}>
      <button
        type="button"
        className="task__check"
        onClick={pending ? onUndo : onFinish}
        aria-pressed={pending}
        aria-label={pending ? `Undo completing ${task.title}` : `Mark ${task.title} done`}
      >
        <span className="task__box">{pending && <Check />}</span>
      </button>

      <div className="task__body">
        <span className="task__title">{task.title}</span>
        {notes && !pending && (
          <button
            type="button"
            className="task__notes"
            data-expanded={notesOpen}
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((open) => !open)}
          >
            {notes}
          </button>
        )}
        {pending ? (
          <span className="task__meta">
            <button type="button" className="task__undo" onClick={onUndo}>
              Undo
            </button>
          </span>
        ) : (
          (due || who || tags.length > 0) && (
            <span className="task__meta">
              {due && (
                <span className="task__due" data-tone={due.tone}>
                  {due.text}
                </span>
              )}
              {who && <span className="task__who">{who}</span>}
              {tags.map((tag) => (
                <span key={tag} className="task__tag">
                  #{tag}
                </span>
              ))}
            </span>
          )
        )}
      </div>
    </li>
  );
}

export function TasksWidget({ instance, config, envelope }: WidgetProps<TasksSnapshot>) {
  const now = useNow();
  const actions = useTaskActions();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const data = envelope?.data;
  if (!data) return null;

  const options = instance.options as TasksOptions;
  const { timezone } = config.location;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (await actions.add(draft.trim())) {
      setDraft("");
      setAdding(false);
    }
  };

  const visible = data.tasks.filter(
    (task) => !actions.done.has(task.id) && (!options.assignee || task.assigneeId === options.assignee),
  );

  return (
    <div className="tasks">
      {visible.length === 0 ? (
        <p className="tasks__empty">{options.assignee ? "Nothing assigned to you." : "All clear."}</p>
      ) : (
        <ul className="tasks__list">
          {visible.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              pending={task.id in actions.finishing}
              now={now}
              timezone={timezone}
              clock={config.units.clock}
              // In a "my tasks" view every task is yours, so the name is noise.
              showAssignee={!options.assignee}
              onFinish={() => actions.finish(task)}
              onUndo={() => actions.undo(task.id)}
            />
          ))}
        </ul>
      )}

      {actions.error && (
        <p className="tasks__error" role="alert">
          {actions.error}
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
            <button type="submit" className="tasks__submit" disabled={actions.busy || !draft.trim()}>
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
