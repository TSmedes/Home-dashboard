import type { ComponentType } from "react";
import type { DashboardConfig, WidgetEnvelope, WidgetInstance } from "@home-dash/shared";

export interface WidgetProps<T = unknown> {
  instance: WidgetInstance;
  config: DashboardConfig;
  /** Null for widgets that need no server data, such as the clock. */
  envelope: WidgetEnvelope<T> | null;
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
}
