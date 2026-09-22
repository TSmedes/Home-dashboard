import type { SystemSnapshot } from "@home-dash/shared";
import { Meter } from "./SystemParts.js";
import { formatBytes, levelFor, percent } from "./system.js";
import type { WidgetProps } from "./types.js";

const DISK_WARN = 85;
const DISK_CRIT = 95;

const LEVEL_WORD = { ok: null, warn: "Getting full", crit: "Almost full" } as const;

/** Space on each configured mount: how full, and how much is left. */
export function DisksWidget({ envelope }: WidgetProps<SystemSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;

  return (
    <ul className="sysrows">
      {data.disks.map((disk) => {
        if (disk.total === null || disk.used === null || disk.free === null) {
          return (
            <li key={disk.path} className="sysrow" data-level="crit">
              <span className="sysrow__name">
                {disk.name}
                <span className="sysrow__alert">Not mounted</span>
              </span>
              <span className="sysrow__value">—</span>
              <span className="sysrow__detail">Nothing readable at {disk.path}</span>
            </li>
          );
        }
        // Percent of the space a user can have, as df reports it.
        const used = percent(disk.used, disk.used + disk.free);
        const level = levelFor(used, DISK_WARN, DISK_CRIT);
        const word = LEVEL_WORD[level];
        return (
          <li key={disk.path} className="sysrow" data-level={level}>
            <span className="sysrow__name">
              {disk.name}
              {word && <span className="sysrow__alert">{word}</span>}
            </span>
            <span className="sysrow__value tnum">{Math.round(used)}%</span>
            <Meter value={used} level={level} label={`${disk.name} ${Math.round(used)} percent full`} />
            <span className="sysrow__detail tnum">
              {formatBytes(disk.free)} free of {formatBytes(disk.total)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
