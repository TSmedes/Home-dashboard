import { riverGaugesFor, type FloodCategory, type RiverGauge, type RiverSnapshot } from "@home-dash/shared";
import { dateKey, dayPhrase } from "../../lib/zoned.js";
import { CATEGORY_LABEL, dayTicks, formatLevel, sparkline, trendOf } from "../river.js";
import type { WidgetProps } from "../types.js";
import { Stats } from "./parts.js";

const W = 800;
const H = 240;

const THRESHOLDS = ["action", "minor", "moderate", "major"] as const satisfies readonly Exclude<FloodCategory, "none">[];
const THRESHOLD_LABEL = { action: "Action", minor: "Minor", moderate: "Moderate", major: "Major" } as const;

const ARROW = { rising: "↗", falling: "↘", steady: "→" } as const;

/**
 * Two days of readings and the forecast after them on one time axis, with
 * midnights marked and every flood threshold that fits drawn across it.
 * Labels are HTML laid over the SVG, so they stay crisp however the chart is
 * stretched to fit the screen.
 */
function BigChart({ gauge, timezone }: { gauge: RiverGauge; timezone: string }) {
  const line = sparkline(gauge, W, H);
  if (!line) return <p className="widget-message__detail">Not enough readings to draw yet.</p>;

  const pct = (t: number) => ((t - line.t0) / Math.max(line.t1 - line.t0, 1)) * 100;
  const lastObserved = gauge.observed.at(-1);
  const levels = THRESHOLDS.flatMap((category) => {
    const value = gauge.thresholds[category];
    return value !== undefined && value <= line.top ? [{ category, value, y: 100 - (value / line.top) * 100 }] : [];
  });

  return (
    <div className="riverd__chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {levels.map((level) => (
          <line
            key={level.category}
            className="riverd__level"
            data-category={level.category}
            x1="0"
            x2={W}
            y1={(level.y / 100) * H}
            y2={(level.y / 100) * H}
          />
        ))}
        <path className="river__observed" d={line.observed} />
        {line.forecast && <path className="river__forecast" d={line.forecast} />}
      </svg>
      {dayTicks(line.t0, line.t1, timezone).map((tick) => (
        <span className="riverd__tick" key={tick.at} style={{ left: `${pct(tick.at)}%` }}>
          {tick.label}
        </span>
      ))}
      {lastObserved && (
        <span className="riverd__now" style={{ left: `${pct(Date.parse(lastObserved.time))}%` }}>
          Now
        </span>
      )}
      {levels.map((level) => (
        <span className="riverd__level-label" key={level.category} style={{ top: `${level.y}%` }}>
          {THRESHOLD_LABEL[level.category]} {formatLevel(level.value, gauge.unit)}
        </span>
      ))}
    </div>
  );
}

function Gauge({ gauge, timezone }: { gauge: RiverGauge; timezone: string }) {
  const today = dateKey(new Date(), timezone);
  const trend = trendOf(gauge);
  const peak = gauge.forecastPeak;
  const change =
    gauge.change6h === null
      ? "—"
      : `${gauge.change6h > 0 ? "+" : gauge.change6h < 0 ? "−" : ""}${formatLevel(Math.abs(gauge.change6h), gauge.unit)}`;

  return (
    <section className="riverd__gauge" data-category={gauge.category}>
      <header className="riverd__head">
        <h3 className="riverd__name">{gauge.name}</h3>
        <span className="river__category" data-alert={gauge.category !== "none"}>
          {CATEGORY_LABEL[gauge.category]}
        </span>
      </header>

      <Stats
        items={[
          {
            label: "Now",
            value: gauge.current ? formatLevel(gauge.current.value, gauge.unit) : "—",
            detail: trend ? `${ARROW[trend]} ${trend}` : undefined,
          },
          { label: "Last 6 hours", value: change },
          {
            label: "Forecast peak",
            value: peak ? formatLevel(peak.value, gauge.unit) : "No forecast",
            detail: peak ? dayPhrase(dateKey(new Date(peak.time), timezone), today) : undefined,
          },
          ...THRESHOLDS.flatMap((category) => {
            const value = gauge.thresholds[category];
            return value === undefined ? [] : [{ label: `${THRESHOLD_LABEL[category]} stage`, value: formatLevel(value, gauge.unit) }];
          }),
        ]}
      />

      <BigChart gauge={gauge} timezone={timezone} />
    </section>
  );
}

/** Each gauge the tile watches, with its full chart and every threshold. */
export function RiverDetail({ instance, config, envelope }: WidgetProps<RiverSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;

  const timezone = config.location.timezone;
  const wanted = riverGaugesFor(instance.options, config.river.gauges);
  const gauges = wanted.flatMap((id) => data.gauges.find((g) => g.gauge === id) ?? []);
  const failed = data.failed.filter((f) => wanted.includes(f.gauge));

  return (
    <div className="detail riverd">
      {gauges.map((gauge) => (
        <Gauge key={gauge.gauge} gauge={gauge} timezone={timezone} />
      ))}
      {failed.map((f) => (
        <p key={f.gauge} className="river__failed">
          No reading from {f.gauge}: {f.message}
        </p>
      ))}
    </div>
  );
}
