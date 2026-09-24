import type { PiholeSnapshot } from "@home-dash/shared";
import type { WidgetProps } from "./types.js";

export const BLOCKING_WORD = {
  enabled: "Blocking on",
  disabled: "Blocking OFF",
  failed: "Blocking failed",
  unknown: "Blocking unknown",
} as const;

const count = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/**
 * Whether Pi-hole is filtering, how many devices lean on it, and what it has
 * stopped since midnight. Blocking switched off is the one thing worth
 * noticing from across the room, so it takes the warning colour.
 */
export function PiholeWidget({ envelope }: WidgetProps<PiholeSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;
  const state = data.blocking === "enabled" ? "up" : "down";

  return (
    <div className="pihole">
      <p className="pihole__status" data-state={state}>
        <span className="pihole__dot" aria-hidden="true" />
        {BLOCKING_WORD[data.blocking]}
      </p>

      <div className="pihole__figures">
        <div className="pihole__figure">
          <span className="pihole__label">Devices</span>
          <span className="pihole__value tnum">{count.format(data.activeClients)}</span>
        </div>
        <div className="pihole__figure">
          <span className="pihole__label">Blocked today</span>
          <span className="pihole__value tnum">{count.format(data.blockedToday)}</span>
          <span className="pihole__sub tnum">{data.percentBlocked.toFixed(1)}%</span>
        </div>
      </div>

      <span className="pihole__foot tnum">
        {count.format(data.queriesToday)} queries today · {compact.format(data.domainsOnList)} domains on list
      </span>
    </div>
  );
}
