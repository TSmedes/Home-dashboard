import type { SystemSnapshot } from "@home-dash/shared";
import { CpuWidget } from "../CpuWidget.js";
import { DisksWidget } from "../DisksWidget.js";
import { NetworkWidget } from "../NetworkWidget.js";
import { formatBytes, formatUptime } from "../system.js";
import { TempsWidget } from "../TempsWidget.js";
import type { WidgetProps } from "../types.js";
import { Stats } from "./parts.js";

/**
 * The whole server on one screen, whichever of its tiles was tapped. Each
 * panel is the tile itself at a larger size - the tiles already scale with
 * their container - with every sensor and disk rather than the first few.
 */
export function SystemDetail({ instance, config, envelope }: WidgetProps<SystemSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;
  const { cpu, memory } = data;
  const all = { ...instance, options: { ...instance.options, limit: 99 } };
  const props = { instance: all, config, envelope };

  return (
    <div className="detail sysd">
      <Stats
        items={[
          { label: "Host", value: data.hostname, detail: `up ${formatUptime(data.uptimeSeconds)}` },
          { label: "Load", value: cpu.load.map((l) => l.toFixed(2)).join("  "), detail: `1, 5, 15 min · ${cpu.cores} cores` },
          { label: "Memory free", value: formatBytes(memory.available), detail: `of ${formatBytes(memory.total)}` },
          {
            label: "Swap",
            value: memory.swapTotal > 0 ? formatBytes(memory.swapUsed) : "None",
            detail: memory.swapTotal > 0 ? `of ${formatBytes(memory.swapTotal)}` : undefined,
          },
        ]}
      />
      <div className="sysd__panels">
        <section className="sysd__panel sysd__panel--cpu" aria-label="CPU and memory">
          <CpuWidget {...props} />
        </section>
        <section className="sysd__panel" aria-label="Network">
          <h3 className="detail__heading">Network</h3>
          <div className="sysd__body">
            <NetworkWidget {...props} />
          </div>
        </section>
        <section className="sysd__panel" aria-label="Temperatures">
          <h3 className="detail__heading">Temperatures</h3>
          <div className="sysd__body">
            <TempsWidget {...props} />
          </div>
        </section>
        <section className="sysd__panel" aria-label="Disks">
          <h3 className="detail__heading">Disks</h3>
          <div className="sysd__body">
            <DisksWidget {...props} />
          </div>
        </section>
      </div>
    </div>
  );
}
