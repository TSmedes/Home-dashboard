import type { ComponentType } from "react";
import type { DashboardConfig, WidgetEnvelope, WidgetInstance } from "@home-dash/shared";
import type { OptionSpec } from "../edit/options.js";

export interface WidgetProps<T = unknown> {
  instance: WidgetInstance;
  config: DashboardConfig;
  /** Null for widgets that need no server data, such as the clock. */
  envelope: WidgetEnvelope<T> | null;
}

/** What a widget's settings can be worked out from, when they are not fixed. */
export interface OptionContext {
  config: DashboardConfig;
  /** The live data, for settings whose choices come from it - who tasks belong to. */
  envelope: WidgetEnvelope<unknown> | null;
}

/** What the widget's own panel needs to edit the settings it reads. */
export interface WidgetConfigProps {
  instance: WidgetInstance;
  /** The staged config. Nothing here is written until Save. */
  config: DashboardConfig;
  update: (recipe: (draft: DashboardConfig) => DashboardConfig) => void;
}

export interface WidgetDefinition {
  type: string;
  component: ComponentType<WidgetProps<never>>;
  /** Cache source this widget reads. Omit for widgets with no server data. */
  dataKey?: string;
  /**
   * Whether to draw the surface panel behind it. The clock opts out and sits
   * directly on the background, which is what makes it read as primary.
   */
  chrome?: boolean;
  /** What to do when its source is not set up. Defaults to running the setup wizard. */
  setupHint?: string;
  /**
   * The full-screen view a tap on the tile grows into, with more detail and
   * more controls. Omit it for a widget that says everything on its tile.
   */
  detail?: ComponentType<WidgetProps<never>>;
  /** What the full-screen view is called, when it shows more than the tile's own title says. */
  detailTitle?: string;
  /**
   * Whether this widget has anything worth the wall right now. Returning false
   * gives its space to whatever it is stacked with, as though it were switched
   * off. Omit it for a widget that always earns its place.
   */
  relevant?: (args: { instance: WidgetInstance; config: DashboardConfig; now: Date }) => boolean;
  /**
   * The settings this widget reads out of its own `options`, described so edit
   * mode can build the controls. A function when the choices depend on what is
   * configured or on the live data.
   */
  options?: OptionSpec[] | ((context: OptionContext) => OptionSpec[]);
  /**
   * Editor for the settings this widget reads from outside its own options -
   * the countdowns list, the commute destinations, the bins. Generated
   * controls cannot express those, so a widget that needs one brings its own.
   */
  configEditor?: ComponentType<WidgetConfigProps>;
}

/** The settings a widget offers here and now. */
export function specsFor(definition: WidgetDefinition, context: OptionContext): OptionSpec[] {
  const { options } = definition;
  if (!options) return [];
  return typeof options === "function" ? options(context) : options;
}
