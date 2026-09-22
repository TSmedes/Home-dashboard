import { WEEKDAYS, type BinConfig, type DashboardConfig, type Weekday } from "@home-dash/shared";
import { CommitInput, Segmented } from "../../settings/controls.js";
import { Row, Section } from "../../settings/parts.js";
import type { WidgetConfigProps } from "../../widgets/types.js";

const DAY_NAMES: Record<Weekday, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Which bins go out when.
 *
 * Weekly collections need only a day. Anything less often needs a date one
 * actually happened, because that is what says which weeks are collection
 * weeks - and the schema refuses a config without one, so the editor supplies
 * a date the moment "every" goes above 1 rather than letting Save fail.
 *
 * Holiday shifts and skipped collections are left to the file. They are typed
 * in once a year from a council letter, which is a different sort of job from
 * arranging the wall.
 */
export function BinsEditor({ config, update }: WidgetConfigProps) {
  const bins = config.bins;

  const setBins = (next: BinConfig[]) => update((draft: DashboardConfig) => ({ ...draft, bins: next }));

  const edit = (index: number, change: Partial<BinConfig>) =>
    setBins(
      bins.map((bin, i) => {
        if (i !== index) return bin;
        const next = { ...bin, ...change };
        // An anchor is required as soon as it is not every week.
        if (next.every > 1 && !next.anchor) next.anchor = today();
        return next;
      }),
    );

  return (
    <Section title="Bin collections">
      {bins.length === 0 && <p className="settings__empty">No collections set up.</p>}

      {bins.map((bin, index) => (
        <Row
          key={index}
          label={bin.name || "Untitled"}
          detail={bin.every === 1 ? `Every ${DAY_NAMES[bin.day]}` : `Every ${bin.every} weeks on ${DAY_NAMES[bin.day]}`}
        >
          <div className="editor-row editor-row--wrap">
            <CommitInput value={bin.name} label="What it is" onCommit={(name) => edit(index, { name })} />
            <Segmented
              label={`Which day ${bin.name} goes out`}
              value={bin.day}
              options={WEEKDAYS.map((day) => ({ value: day, label: DAY_NAMES[day] }))}
              onChange={(day) => edit(index, { day })}
            />
            <div className="edit-stepper">
              <span className="edit-stepper__label">Every</span>
              <button
                type="button"
                aria-label="Less often"
                disabled={bin.every <= 1}
                onClick={() => edit(index, { every: bin.every - 1 })}
              >
                &minus;
              </button>
              <span className="edit-stepper__value">{bin.every === 1 ? "week" : `${bin.every} wks`}</span>
              <button
                type="button"
                aria-label="More often"
                disabled={bin.every >= 8}
                onClick={() => edit(index, { every: bin.every + 1 })}
              >
                +
              </button>
            </div>
            {bin.every > 1 && (
              <CommitInput
                value={bin.anchor ?? today()}
                label="A date it was collected"
                type="date"
                onCommit={(anchor) => edit(index, { anchor })}
              />
            )}
            <button
              type="button"
              className="button button--quiet"
              aria-label={`Remove ${bin.name}`}
              onClick={() => setBins(bins.filter((_, i) => i !== index))}
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
          onClick={() => setBins([...bins, { name: "New bin", day: "mon", every: 1, moved: [], skip: [] }])}
        >
          Add a collection
        </button>
        <p className="settings__empty">
          Holiday shifts and skipped weeks are set in config.yaml, under <strong>moved</strong> and{" "}
          <strong>skip</strong>.
        </p>
      </div>
    </Section>
  );
}
