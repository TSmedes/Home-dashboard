import type { CountdownConfig, DashboardConfig } from "@home-dash/shared";
import { CommitInput } from "../../settings/controls.js";
import { Row, Section } from "../../settings/parts.js";
import type { WidgetConfigProps } from "../../widgets/types.js";

/** A date a month out, so a new countdown starts somewhere sensible. */
function soon(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

/**
 * The countdowns themselves.
 *
 * They live at `countdowns.items`, shared by every countdowns widget on every
 * profile, so they are not a setting of this tile - but this tile is where you
 * are looking when you want to add one, which is the whole point of editing
 * the thing where you can see it.
 */
export function CountdownsEditor({ config, update }: WidgetConfigProps) {
  const items = config.countdowns.items;

  const setItems = (next: CountdownConfig[]) =>
    update((draft: DashboardConfig) => ({ ...draft, countdowns: { ...draft.countdowns, items: next } }));

  const edit = (index: number, change: Partial<CountdownConfig>) =>
    setItems(items.map((item, i) => (i === index ? { ...item, ...change } : item)));

  return (
    <Section title="Countdowns">
      {items.length === 0 && <p className="settings__empty">Nothing counted down to yet.</p>}

      {items.map((item, index) => (
        <Row key={index} label={item.name || "Untitled"} detail={item.date}>
          <div className="editor-row">
            <CommitInput
              value={item.name}
              label="What it is"
              onCommit={(name) => edit(index, { name })}
            />
            <CommitInput
              value={item.date}
              label="When"
              type="date"
              onCommit={(date) => edit(index, { date })}
            />
            <button
              type="button"
              className="button button--quiet"
              aria-label={`Remove ${item.name}`}
              onClick={() => setItems(items.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        </Row>
      ))}

      <div className="settings__lead">
        <button
          type="button"
          className="button"
          onClick={() => setItems([...items, { name: "New countdown", date: soon() }])}
        >
          Add countdown
        </button>
        <p className="settings__empty">
          Calendar events with <strong>{config.countdowns.calendarTag}</strong> in the title show up here too, without
          being listed.
        </p>
      </div>
    </Section>
  );
}
