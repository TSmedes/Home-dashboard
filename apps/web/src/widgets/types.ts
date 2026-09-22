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
}
