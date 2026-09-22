import type { DashboardConfig, WidgetEnvelope, WidgetInstance } from "@home-dash/shared";
import { widgetFor } from "../widgets/registry.js";
import { WidgetErrorBoundary } from "./ErrorBoundary.js";
import { WidgetFrame } from "./WidgetFrame.js";

interface Props {
  instance: WidgetInstance;
  config: DashboardConfig;
  envelopes: Record<string, WidgetEnvelope<unknown>>;
  availableSources: string[];
  /** Given when the tile can grow to full screen. Never in edit mode. */
  onExpand?: (from: HTMLElement) => void;
}

/** Whether a widget can grow to full screen: it has a detail view and data to show in it. */
export function expandable(instance: WidgetInstance, availableSources: string[]): boolean {
  const definition = widgetFor(instance.type);
  return definition?.detail !== undefined && (!definition.dataKey || availableSources.includes(definition.dataKey));
}

/**
 * One widget, drawn: the real thing, a note that it needs setting up, or a
 * note that nothing knows how to draw it.
 *
 * The dashboard and the layout editor both put these on a grid, and edit mode
 * is only worth having if what you arrange looks like what you will get - so
 * they draw the same tile rather than each having their own idea of one.
 */
export function WidgetTile({ instance, config, envelopes, availableSources, onExpand }: Props) {
  const definition = widgetFor(instance.type);
  const envelope = definition?.dataKey ? (envelopes[definition.dataKey] ?? null) : null;
  const needsSetup = definition?.dataKey !== undefined && !availableSources.includes(definition.dataKey);

  return (
    <WidgetErrorBoundary name={instance.id}>
      {!definition ? (
        <section className="widget surface">
          <div className="widget-message">
            <p>No widget called &ldquo;{instance.type}&rdquo;.</p>
            <p className="widget-message__detail">Check the type in config.yaml.</p>
          </div>
        </section>
      ) : needsSetup ? (
        <section className={`widget surface widget--${instance.type}`}>
          {instance.title && (
            <header className="widget__head">
              <h2 className="widget__title">{instance.title}</h2>
            </header>
          )}
          <div className="widget-message">
            <p>Not connected yet.</p>
            <p className="widget-message__detail">{definition?.setupHint ?? "Run npm run setup to link this account."}</p>
          </div>
        </section>
      ) : (
        <WidgetFrame
          type={instance.type}
          title={instance.title}
          chrome={definition.chrome ?? true}
          envelope={envelope}
          timezone={config.location.timezone}
          clock={config.units.clock}
          onExpand={onExpand}
        >
          <definition.component instance={instance} config={config} envelope={envelope as never} />
        </WidgetFrame>
      )}
    </WidgetErrorBoundary>
  );
}
