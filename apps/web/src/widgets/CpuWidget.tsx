import type { SystemSnapshot } from "@home-dash/shared";
import { Meter, Spark } from "./SystemParts.js";
import { formatBytes, levelFor, percent } from "./system.js";
import type { WidgetProps } from "./types.js";

const CPU_WARN = 80;
const CPU_CRIT = 95;
const MEMORY_WARN = 85;
const MEMORY_CRIT = 95;

const LEVEL_WORD = { ok: null, warn: "Busy", crit: "Maxed out" } as const;

function Stat({
  name,
  value,
  level,
  history,
  detail,
}: {
  name: string;
  value: number;
  level: "ok" | "warn" | "crit";
  history: number[];
  detail: string;
}) {
  const word = LEVEL_WORD[level];
  return (
    <div className="sysstat" data-level={level}>
      <div className="sysstat__head">
        <span className="sysstat__name">{name}</span>
        {word && <span className="sysstat__alert">{word}</span>}
      </div>
      <span className="sysstat__value tnum">
        {Math.round(value)}
        <span className="sysstat__unit">%</span>
      </span>
      <Meter value={value} level={level} label={`${name} ${Math.round(value)} percent`} />
      <Spark values={history} max={100} className="sysstat__spark" />
      <span className="sysstat__detail tnum">{detail}</span>
    </div>
  );
}

/** CPU and memory side by side: the big number, a bar, and the last ten minutes. */
export function CpuWidget({ envelope }: WidgetProps<SystemSnapshot>) {
  const data = envelope?.data;
  if (!data) return null;
  const { cpu, memory } = data;
  const memoryPercent = percent(memory.used, memory.total);
  const swap = memory.swapTotal > 0 ? ` · swap ${formatBytes(memory.swapUsed)}` : "";

  return (
    <div className="cpu">
      <Stat
        name="CPU"
        value={cpu.usage}
        level={levelFor(cpu.usage, CPU_WARN, CPU_CRIT)}
        history={cpu.history}
        detail={`${cpu.cores} cores · load ${cpu.load.map((l) => l.toFixed(2)).join(" ")}`}
      />
      <Stat
        name="Memory"
        value={memoryPercent}
        level={levelFor(memoryPercent, MEMORY_WARN, MEMORY_CRIT)}
        history={memory.history}
        detail={`${formatBytes(memory.used)} of ${formatBytes(memory.total)}${swap}`}
      />
    </div>
  );
}
