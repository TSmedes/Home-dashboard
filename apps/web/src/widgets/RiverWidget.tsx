import { riverGaugesFor, type RiverGauge, type RiverSnapshot } from "@home-dash/shared";
import { dateKey, dayPhrase } from "../lib/zoned.js";
import { CATEGORY_LABEL, formatLevel, nextThreshold, shortName, sparkline, trendOf } from "./river.js";
import type { WidgetProps } from "./types.js";

const W = 300;
const H = 64;

/** How each threshold reads as the next one to watch for. */
const THRESHOLD_LABEL = {
  action: "Action stage",
  minor: "Minor flooding",
  moderate: "Moderate flooding",
  major: "Major flooding",
} as const;

const ARROW = { rising: "↗", falling: "↘", steady: "→" } as const;

function Chart({ gauge, width, height, className }: { gauge: RiverGauge; width: number; height: number; className: string }) {
  const line = sparkline(gauge, width, height);
  if (!line) return null;
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {line.threshold && (
        <line className="river__threshold" x1="0" x2={width} y1={line.threshold.y} y2={line.threshold.y} />
      )}
      <path className="river__observed" d={line.observed} />
      {line.forecast && <path className="river__forecast" d={line.forecast} />}
    </svg>
  );
}

/** One gauge with room to spare: the big number, a chart and what to watch for. */
function GaugeDetail({ gauge, timezone }: { gauge: RiverGauge; timezone: string }) {
  if (!gauge.current) {
    return (
      <div className="widget-message">
        <p>{gauge.name}</p>
        <p className="widget-message__detail">The gauge hasn't reported recently.</p>
      </div>
    );
  }

  const today = dateKey(new Date(), timezone);
  const trend = trendOf(gauge);
  const next = nextThreshold(gauge);
  const peak = gauge.forecastPeak;

  return (
    <div className="river" data-category={gauge.category}>
      <div className="river__now">
        <span className="river__level tnum">{formatLevel(gauge.current.value, gauge.unit)}</span>
        <span className="river__state">
          <span className="river__category" data-alert={gauge.category !== "none"}>
            {CATEGORY_LABEL[gauge.category]}
          </span>
          {trend && (
            <span className="river__trend">
              <span aria-hidden="true">{ARROW[trend]}</span> {trend}
            </span>
          )}
        </span>
      </div>

      <Chart gauge={gauge} width={W} height={H} className="river__chart" />

      <p className="river__detail">
        {next && (
          <span>
            {THRESHOLD_LABEL[next.category]} at {formatLevel(next.value, gauge.unit)}
          </span>
        )}
        {peak && peak.value > gauge.current.value && (
          <span>
            Forecast peak {formatLevel(peak.value, gauge.unit)} {dayPhrase(dateKey(new Date(peak.time), timezone), today)}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Several gauges, one row each: name and trend, a small chart, and the
 * reading. The forks are small rivers with no flood thresholds of their own,
 * so the row leads with the flow and whether it is heading up.
 */
function GaugeRow({ gauge, timezone }: { gauge: RiverGauge; timezone: string }) {
  const today = dateKey(new Date(), timezone);
  const trend = trendOf(gauge);
  const peak = gauge.forecastPeak;
  const rising = peak && gauge.current && peak.value > gauge.current.value * 1.1;

  return (
    <li className="river__row" data-category={gauge.category}>
      <span className="river__row-name">
        {shortName(gauge.name)}
        <span className="river__row-sub">
          {gauge.category !== "none" ? (
            <span className="river__category" data-alert="true">
              {CATEGORY_LABEL[gauge.category]}
            </span>
          ) : trend ? (
            <>
              <span aria-hidden="true">{ARROW[trend]}</span> {trend}
            </>
          ) : (
            "No recent reading"
          )}
        </span>
        {rising && (
          <span className="river__row-sub">
            Peak {formatLevel(peak.value, gauge.unit)} {dayPhrase(dateKey(new Date(peak.time), timezone), today)}
          </span>
        )}
      </span>
      <Chart gauge={gauge} width={120} height={32} className="river__row-chart" />
      <span className="river__row-level tnum">{gauge.current ? formatLevel(gauge.current.value, gauge.unit) : "—"}</span>
    </li>
  );
}

export function RiverWidget({ instance, config, envelope }: WidgetProps<RiverSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;

  const timezone = config.location.timezone;
  const wanted = riverGaugesFor(instance.options, config.river.gauges);
  const gauges = wanted.flatMap((id) => data.gauges.find((g) => g.gauge === id) ?? []);
  const failed = wanted.filter((id) => data.failed.some((f) => f.gauge === id));

  if (gauges.length === 0) {
    return (
      <div className="widget-message">
        <p>{failed.length > 0 ? "Couldn't read that gauge." : "Waiting for the first reading."}</p>
        {failed.length > 0 && (
          <p className="widget-message__detail">Check {failed.join(", ")} on water.noaa.gov.</p>
        )}
      </div>
    );
  }

  if (gauges.length === 1) return <GaugeDetail gauge={gauges[0]!} timezone={timezone} />;

  return (
    <div className="river river--list">
      <ul className="river__rows">
        {gauges.map((gauge) => (
          <GaugeRow key={gauge.gauge} gauge={gauge} timezone={timezone} />
        ))}
      </ul>
      {failed.length > 0 && <p className="river__failed">No reading from {failed.join(", ")} right now.</p>}
    </div>
  );
}
