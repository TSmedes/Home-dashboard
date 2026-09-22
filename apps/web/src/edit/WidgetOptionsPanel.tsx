import { useEffect, useRef } from "react";
import type { DashboardConfig, WidgetEnvelope, WidgetInstance } from "@home-dash/shared";
import { CommitInput, Segmented, Switch } from "../settings/controls.js";
import { Row, Section } from "../settings/parts.js";
import { WIDGET_NAMES } from "../widgets/names.js";
import { widgetFor } from "../widgets/registry.js";
import { specsFor } from "../widgets/types.js";
import { clampOption, optionValue, setOption, type OptionSpec } from "./options.js";

interface Props {
  widget: WidgetInstance;
  /** The staged config: this panel edits the draft, like everything else in edit mode. */
  config: DashboardConfig;
  envelope: WidgetEnvelope<unknown> | null;
  onChange: (change: (widgets: WidgetInstance[]) => WidgetInstance[]) => void;
  update: (recipe: (draft: DashboardConfig) => DashboardConfig) => void;
  onClose: () => void;
}

/** One control, chosen by what kind of setting it is. The same ones settings uses. */
function Control({
  spec,
  widget,
  onSet,
}: {
  spec: OptionSpec;
  widget: WidgetInstance;
  onSet: (value: string | number | boolean) => void;
}) {
  const value = optionValue(spec, widget.options);

  if (spec.kind === "boolean") {
    return (
      <Switch
        checked={value === true}
        label={spec.label}
        onChange={async (next) => {
          onSet(next);
        }}
      />
    );
  }

  if (spec.kind === "number") {
    const current = value as number;
    return (
      <div className="edit-stepper">
        <button
          type="button"
          aria-label={`${spec.label} fewer`}
          disabled={current <= spec.min}
          onClick={() => onSet(clampOption(spec, current - 1))}
        >
          &minus;
        </button>
        <span className="edit-stepper__value" aria-live="polite">
          {current}
          {spec.unit ? ` ${spec.unit}` : ""}
        </span>
        <button
          type="button"
          aria-label={`${spec.label} more`}
          disabled={current >= spec.max}
          onClick={() => onSet(clampOption(spec, current + 1))}
        >
          +
        </button>
      </div>
    );
  }

  if (spec.kind === "enum") {
    return (
      <Segmented
        label={spec.label}
        value={value as string}
        options={spec.choices}
        onChange={(next) => onSet(next)}
      />
    );
  }

  return (
    <CommitInput value={value as string} label={spec.label} onCommit={(next) => onSet(next)} />
  );
}

/**
 * A widget's own settings.
 *
 * The display controls are built from what the registry says the widget reads,
 * so a new setting is one entry there rather than a form written by hand. What
 * a generated control cannot express - the countdowns themselves, the commute
 * destinations, the bin collections - the widget brings its own editor for,
 * and it appears here too: you edit the thing where you can see the thing.
 */
export function WidgetOptionsPanel({ widget, config, envelope, onChange, update, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const definition = widgetFor(widget.type);
  const name = widget.title || WIDGET_NAMES[widget.type] || widget.type;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const specs = definition ? specsFor(definition, { config, envelope }) : [];
  const ConfigEditor = definition?.configEditor;

  return (
    <div className="edit-picker" role="dialog" aria-modal="true" aria-label={`${name} settings`}>
      <div className="edit-picker__backdrop" onClick={onClose} />
      <div className="edit-picker__panel edit-picker__panel--wide" ref={panel}>
        <header className="edit-picker__head">
          <h2 className="edit-picker__title">{name}</h2>
          <button type="button" className="button button--primary" onClick={onClose}>
            Done
          </button>
        </header>

        <div className="edit-picker__scroll">
          {specs.length > 0 && (
            <Section title="Display">
              {specs.map((spec) => (
                <Row key={spec.key} label={spec.label} detail={spec.detail}>
                  <Control
                    spec={spec}
                    widget={widget}
                    onSet={(value) => onChange((list) => setOption(list, widget.id, spec, value))}
                  />
                </Row>
              ))}
            </Section>
          )}

          {ConfigEditor && <ConfigEditor instance={widget} config={config} update={update} />}

          {specs.length === 0 && !ConfigEditor && (
            <p className="settings__empty">This widget has nothing to set.</p>
          )}
        </div>
      </div>
    </div>
  );
}
