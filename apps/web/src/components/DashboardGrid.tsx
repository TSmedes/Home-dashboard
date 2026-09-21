import { GRID_COLUMNS, type DashboardConfig, type Profile, type WidgetInstance } from "@home-dash/shared";
import type { WidgetEnvelope } from "@home-dash/shared";
import { widgetFor } from "../widgets/registry.js";
import { WidgetErrorBoundary } from "./ErrorBoundary.js";
import { layout } from "./layout.js";
import { WidgetFrame } from "./WidgetFrame.js";

interface Props {
  config: DashboardConfig;
  profile: Profile;
  envelopes: Record<string, WidgetEnvelope<unknown>>;
  availableSources: string[];
}

export function DashboardGrid({ config, profile, envelopes, availableSources }: Props) {
  const { rows, cells } = layout(profile.widgets);

  const render = (instance: WidgetInstance) => {
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
          <section className="widget surface">
            <div className="widget-message">
              <p>Not connected yet.</p>
              <p className="widget-message__detail">Run npm run setup to link this account.</p>
            </div>
          </section>
        ) : (
          <WidgetFrame
            title={instance.title}
            chrome={definition.chrome ?? true}
            envelope={envelope}
            timezone={config.location.timezone}
            clock={config.units.clock}
          >
            <definition.component instance={instance} config={config} envelope={envelope as never} />
          </WidgetFrame>
        )}
      </WidgetErrorBoundary>
    );
  };

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {cells.map((cell) =>
        cell.kind === "widget" ? (
          <div key={cell.key} className="grid__cell" style={{ gridColumn: cell.column, gridRow: cell.row }}>
            {render(cell.widget)}
          </div>
        ) : (
          // A shared row spans the full width; its widgets split it evenly.
          <div key={cell.key} className="grid__band" style={{ gridColumn: "1 / -1", gridRow: cell.row }}>
            {cell.widgets.map((widget) => (
              <div key={widget.id} className="grid__cell">
                {render(widget)}
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
