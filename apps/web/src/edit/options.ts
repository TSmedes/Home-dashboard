import type { WidgetInstance } from "@home-dash/shared";

/**
 * The settings a widget offers, described rather than drawn.
 *
 * Every widget already reads `options` out of config.yaml and casts it to
 * whatever it expects. Saying so here lets edit mode build the controls, so
 * adding a setting is one entry in the registry rather than a bespoke form -
 * and the description doubles as the documentation that used to live only in
 * a comment in config.example.yaml.
 */

interface Common {
  key: string;
  label: string;
  /** A sentence under the label, for a setting whose effect is not obvious. */
  detail?: string;
}

export type OptionSpec =
  | (Common & { kind: "boolean"; default: boolean })
  | (Common & { kind: "number"; default: number; min: number; max: number; unit?: string })
  | (Common & { kind: "enum"; default: string; choices: { value: string; label: string }[] })
  | (Common & { kind: "text"; default: string; placeholder?: string });

/**
 * A default is required on every spec, not for display but so that setting a
 * value back to normal can remove the key instead of writing a line that says
 * what would have happened anyway.
 */
export function optionValue(spec: OptionSpec, options: Record<string, unknown>): string | number | boolean {
  const value = options[spec.key];
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean" ? value : spec.default;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : spec.default;
    case "enum":
      return typeof value === "string" && spec.choices.some((c) => c.value === value) ? value : spec.default;
    case "text":
      return typeof value === "string" ? value : spec.default;
  }
}

/** A number pulled back inside what the widget can actually use. */
export function clampOption(spec: OptionSpec, value: number): number {
  return spec.kind === "number" ? Math.min(Math.max(Math.round(value), spec.min), spec.max) : value;
}

/**
 * Set one option on one widget.
 *
 * A value back at its default drops the key rather than writing it, which is
 * the convention the settings screen has always followed: returning a setting
 * to normal should leave no trace in the file.
 */
export function setOption(
  widgets: WidgetInstance[],
  id: string,
  spec: OptionSpec,
  next: string | number | boolean,
): WidgetInstance[] {
  return widgets.map((widget) => {
    if (widget.id !== id) return widget;
    const { [spec.key]: _was, ...rest } = widget.options;
    return { ...widget, options: next === spec.default ? rest : { ...rest, [spec.key]: next } };
  });
}
