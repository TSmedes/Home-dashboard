import { useState, type FormEvent } from "react";
import type { TasksSnapshot } from "@home-dash/shared";
import { useNow } from "../../lib/useNow.js";
import { firstName, groupTasks } from "../tasks.js";
import { TaskRow } from "../TasksWidget.js";
import type { WidgetProps } from "../types.js";
import { useTaskActions } from "../useTaskActions.js";

interface TasksOptions {
  assignee?: string;
  readOnly?: boolean;
}

/**
 * The whole list, grouped by when it is due, with a filter for each person
 * the list is shared with and the add box always open.
 */
export function TasksDetail({ instance, config, envelope }: WidgetProps<TasksSnapshot>) {
  const now = useNow();
  const actions = useTaskActions();
  const options = instance.options as TasksOptions;
  // A "my tasks" tile opens on its own person's tasks.
  const [who, setWho] = useState<string | null>(options.assignee ?? null);
  const [draft, setDraft] = useState("");

  const data = envelope?.data;
  if (!data) return null;

  const { timezone } = config.location;
  const people = data.assigneesAvailable ? data.members : [];
  const visible = data.tasks.filter((task) => !actions.done.has(task.id) && (!who || task.assigneeId === who));
  const groups = groupTasks(visible, now, timezone);
  // Dated groups stack on the left; the undated pile, usually the longest, gets the wide side.
  const dated = groups.filter((group) => group.key !== "undated");
  const undated = groups.filter((group) => group.key === "undated");

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (await actions.add(draft.trim())) setDraft("");
  };

  return (
    <div className="detail tasksd">
      <div className="tasksd__bar">
        {people.length > 1 && (
          <div className="tasksd__filters" role="group" aria-label="Whose tasks">
            <button type="button" className="chip" aria-pressed={who === null} onClick={() => setWho(null)}>
              Everyone
            </button>
            {people.map((person) => (
              <button
                key={person.username}
                type="button"
                className="chip"
                aria-pressed={who === person.username}
                onClick={() => setWho(person.username)}
              >
                {firstName(person.displayName)}
              </button>
            ))}
          </div>
        )}

        {!options.readOnly && (
          <form className="tasks__form tasksd__form" onSubmit={add}>
            <input
              className="tasks__input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={`Add to ${data.listName}`}
              aria-label={`New task for ${data.listName}`}
              enterKeyHint="done"
              maxLength={500}
            />
            <button type="submit" className="tasks__submit" disabled={actions.busy || !draft.trim()}>
              Add
            </button>
          </form>
        )}
      </div>

      {actions.error && (
        <p className="tasks__error" role="alert">
          {actions.error}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="tasks__empty">{who ? "Nothing assigned here." : "All clear."}</p>
      ) : (
        <div className="tasksd__groups" data-split={dated.length > 0 && undated.length > 0}>
          {[dated, undated]
            .filter((column) => column.length > 0)
            .map((column) => (
              <div className="tasksd__column" key={column[0]!.key}>
                {column.map((group) => (
                  <section className="tasksd__group" key={group.key} data-group={group.key}>
                    <h3 className="tasksd__label">
                      {group.label}
                      <span className="tasksd__count">{group.tasks.length}</span>
                    </h3>
                    <ul className="tasks__list">
                      {group.tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          pending={task.id in actions.finishing}
                          now={now}
                          timezone={timezone}
                          clock={config.units.clock}
                          showAssignee={!who}
                          showTags
                          showNotes
                          onFinish={() => actions.finish(task)}
                          onUndo={() => actions.undo(task.id)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
