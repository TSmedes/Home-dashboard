import type { SystemSnapshot } from "@home-dash/shared";
import { formatRate, formatUptime, seriesPath } from "./system.js";
import type { WidgetProps } from "./types.js";

const W = 300;
const H = 64;

/**
 * The host's name and how long it has been up, then traffic on its main
 * interface. Download and upload share one scale - both are bytes per
 * second - and are told apart by line style as well as by colour.
 */
export function NetworkWidget({ envelope }: WidgetProps<SystemSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;
  const net = data.network;
  const top = net ? Math.max(...net.rxHistory, ...net.txHistory, 1) : 1;
  const down = net && seriesPath(net.rxHistory, W, H, top);
  const up = net && seriesPath(net.txHistory, W, H, top);

  return (
    <div className="net">
      <div className="net__host">
        <span className="net__name">{data.hostname}</span>
        <span className="net__uptime">Up {formatUptime(data.uptimeSeconds)}</span>
      </div>

      {net ? (
        <>
          <div className="net__rates">
            <span className="net__rate net__rate--down">
              <span className="net__key" aria-hidden="true" />
              <span className="net__label">↓ Down</span>
              <span className="net__value tnum">{formatRate(net.rxBps)}</span>
            </span>
            <span className="net__rate net__rate--up">
              <span className="net__key" aria-hidden="true" />
              <span className="net__label">↑ Up</span>
              <span className="net__value tnum">{formatRate(net.txBps)}</span>
            </span>
          </div>
          {down && up && (
            <svg className="net__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              <path className="net__line net__line--down" d={down} />
              <path className="net__line net__line--up" d={up} />
            </svg>
          )}
          <span className="net__iface">
            {net.iface} · peak {formatRate(top)}
          </span>
        </>
      ) : (
        <p className="widget-message__detail">No network interface found.</p>
      )}
    </div>
  );
}
