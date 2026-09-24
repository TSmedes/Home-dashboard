import type { PiholeCount, PiholeSnapshot } from "@home-dash/shared";
import { clockTime, dateKey, zonedMidnight } from "../../lib/zoned.js";
import { useNow } from "../../lib/useNow.js";
import { ago } from "../../settings/model.js";
import { BLOCKING_WORD } from "../PiholeWidget.js";
import type { WidgetProps } from "../types.js";
import { Section, Stats } from "./parts.js";

const W = 1440;
const H = 200;
const DAY_MS = 86_400_000;
const BUCKET_MS = 600_000;

const count = new Intl.NumberFormat();
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");

/**
 * Today from midnight to midnight, one bar per ten minutes: all queries in the
 * pale bar, the blocked share of them drawn over it. The rest of the day is
 * left empty rather than stretched, so the time of day reads off the axis.
 */
function DayChart({ data, timezone, clock }: { data: PiholeSnapshot; timezone: string; clock: "12h" | "24h" }) {
  const now = useNow();
  const midnight = zonedMidnight(dateKey(now, timezone), timezone);
  const top = Math.max(...data.history.map((b) => b.total), 1);
  const barW = (W * BUCKET_MS) / DAY_MS;
  const x = (t: number) => ((t - midnight) / DAY_MS) * W;
  const y = (v: number) => H - (v / top) * H;
  const ticks = [6, 12, 18].map((hour) => {
    const at = midnight + hour * 3_600_000;
    const { time, meridiem } = clockTime(new Date(at), timezone, clock);
    const label = clock === "12h" ? (hour === 12 ? "Noon" : `${time.replace(":00", "")} ${meridiem}`) : time;
    return { at, label, left: (x(at) / W) * 100 };
  });

  if (data.history.length === 0) return <p className="widget-message__detail">No queries yet today.</p>;

  return (
    <div className="piholed__chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {data.history.map((b) => {
          const left = x(Date.parse(b.at)) + 1;
          return (
            <g key={b.at}>
              <rect className="piholed__bar" x={left} width={barW - 2} y={y(b.total)} height={H - y(b.total)} />
              <rect className="piholed__bar--blocked" x={left} width={barW - 2} y={y(b.blocked)} height={H - y(b.blocked)} />
            </g>
          );
        })}
      </svg>
      {ticks.map((tick) => (
        <span className="piholed__tick" key={tick.at} style={{ left: `${tick.left}%` }}>
          {tick.label}
        </span>
      ))}
      <span className="piholed__top tnum">{count.format(top)} / 10 min</span>
    </div>
  );
}

/** A ranked list, each row with a bar for its share of the busiest. */
function Ranked({ items, empty }: { items: PiholeCount[]; empty: string }) {
  if (items.length === 0) return <p className="widget-message__detail">{empty}</p>;
  const most = items[0]!.count;
  return (
    <ol className="piholed__list">
      {items.map((item) => (
        <li className="piholed__row" key={`${item.name}-${item.ip ?? ""}`}>
          <span className="piholed__name">{item.name}</span>
          {item.ip && item.ip !== item.name && <span className="piholed__ip tnum">{item.ip}</span>}
          <span className="piholed__count tnum">{count.format(item.count)}</span>
          <span className="piholed__share" style={{ width: `${(item.count / most) * 100}%` }} aria-hidden="true" />
        </li>
      ))}
    </ol>
  );
}

/**
 * Pi-hole in full: today's figures and their shape over the day, then who
 * asks most, what gets blocked most and who answers - the last three are
 * Pi-hole's own 24-hour figures, and say so.
 */
export function PiholeDetail({ config, envelope }: WidgetProps<PiholeSnapshot>) {
  const now = useNow();
  const data = envelope?.data;
  if (!data) return null;
  // Snapshots written before the detail view existed lack its fields.
  const history = data.history ?? [];
  const answered = (data.upstreams ?? []).reduce((sum, u) => sum + u.count, 0);

  return (
    <div className="detail piholed">
      <p className="pihole__status piholed__status" data-state={data.blocking === "enabled" ? "up" : "down"}>
        <span className="pihole__dot" aria-hidden="true" />
        {BLOCKING_WORD[data.blocking]}
        {data.blockingTimer !== null && data.blocking === "disabled" && (
          <span className="piholed__timer tnum"> · back on in {Math.max(1, Math.ceil(data.blockingTimer / 60))} min</span>
        )}
      </p>

      <Stats
        items={[
          { label: "Devices", value: count.format(data.activeClients), detail: `of ${count.format(data.totalClients)} seen` },
          { label: "Queries today", value: count.format(data.queriesToday) },
          { label: "Blocked today", value: count.format(data.blockedToday), detail: pct(data.blockedToday, data.queriesToday) },
          { label: "Domains asked", value: count.format(data.uniqueDomains ?? 0), detail: "last 24 h" },
          {
            label: "Blocklist",
            value: count.format(data.domainsOnList),
            detail: data.listsUpdated ? `updated ${ago(data.listsUpdated, now)}` : "never updated",
          },
        ]}
      />

      <Section title="Today" aside={<span className="piholed__legend">All queries · <b>Blocked</b></span>}>
        <DayChart data={{ ...data, history }} timezone={config.location.timezone} clock={config.units.clock} />
      </Section>

      <div className="piholed__columns">
        <Section title="Most blocked" aside="last 24 h">
          <Ranked items={data.topBlocked ?? []} empty="Nothing blocked yet." />
        </Section>
        <Section title="Busiest devices" aside="last 24 h">
          <Ranked items={data.topClients ?? []} empty="No devices yet." />
        </Section>
      </div>

      {(data.upstreams ?? []).length > 0 && (
        <Section title="Answered by" aside="last 24 h">
          <ul className="piholed__list">
            {data.upstreams.map((u) => (
              <li className="piholed__row" key={`${u.name}-${u.ip}`}>
                <span className="piholed__name">{u.name}</span>
                {u.ip && <span className="piholed__ip tnum">{u.ip}</span>}
                <span className="piholed__count tnum">
                  {pct(u.count, answered)}
                  {u.responseMs !== null && <span className="piholed__ms"> · {u.responseMs} ms</span>}
                </span>
                <span className="piholed__share" style={{ width: `${(u.count / Math.max(answered, 1)) * 100}%` }} aria-hidden="true" />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
