import type { SystemProcess, SystemTemp } from "@home-dash/shared";

/**
 * Parsers for the Linux kernel's text interfaces. Each takes the file's text
 * and returns numbers, so they are tested against captured output rather than
 * the machine the tests happen to run on.
 */

/** Cumulative CPU time across all cores, in clock ticks. */
export interface CpuTimes {
  busy: number;
  total: number;
}

export interface CpuStat {
  times: CpuTimes;
  cores: number;
}

/** /proc/stat. Guest time is already counted in user time, so it is left out. */
export function parseCpuStat(text: string): CpuStat {
  const lines = text.split("\n");
  const first = lines.find((l) => l.startsWith("cpu "));
  if (!first) throw new Error("no cpu line in /proc/stat");
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = first
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number);
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  const cores = lines.filter((l) => /^cpu\d+\s/.test(l)).length;
  return { times: { busy: total - idle - iowait, total }, cores: Math.max(cores, 1) };
}

/** Percent busy between two samples, 0-100. */
export function cpuUsage(prev: CpuTimes, next: CpuTimes): number {
  const total = next.total - prev.total;
  if (total <= 0) return 0;
  return clamp(((next.busy - prev.busy) / total) * 100, 0, 100);
}

export interface Meminfo {
  total: number;
  available: number;
  swapTotal: number;
  swapFree: number;
}

/** /proc/meminfo, converted from kB to bytes. */
export function parseMeminfo(text: string): Meminfo {
  const values = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match) values.set(match[1]!, Number(match[2]) * 1024);
  }
  const total = values.get("MemTotal");
  if (total === undefined) throw new Error("no MemTotal in /proc/meminfo");
  // Kernels before 3.14 have no MemAvailable; free + cache is the old estimate.
  const available =
    values.get("MemAvailable") ??
    (values.get("MemFree") ?? 0) + (values.get("Buffers") ?? 0) + (values.get("Cached") ?? 0);
  return {
    total,
    available,
    swapTotal: values.get("SwapTotal") ?? 0,
    swapFree: values.get("SwapFree") ?? 0,
  };
}

/** /proc/loadavg. */
export function parseLoadavg(text: string): [number, number, number] {
  const [a, b, c] = text.trim().split(/\s+/).map(Number);
  if ([a, b, c].some((n) => n === undefined || Number.isNaN(n))) throw new Error("unreadable /proc/loadavg");
  return [a!, b!, c!];
}

/** /proc/uptime, in whole seconds. */
export function parseUptime(text: string): number {
  const seconds = Number(text.trim().split(/\s+/)[0]);
  if (Number.isNaN(seconds)) throw new Error("unreadable /proc/uptime");
  return Math.floor(seconds);
}

export interface NetCounters {
  rx: number;
  tx: number;
}

/** /proc/net/dev: cumulative bytes per interface. */
export function parseNetDev(text: string): Map<string, NetCounters> {
  const out = new Map<string, NetCounters>();
  for (const line of text.split("\n").slice(2)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const fields = line.slice(colon + 1).trim().split(/\s+/).map(Number);
    out.set(line.slice(0, colon).trim(), { rx: fields[0] ?? 0, tx: fields[8] ?? 0 });
  }
  return out;
}

/** The interface carrying the default route, from /proc/net/route. */
export function defaultInterface(routeText: string): string | null {
  const routes = routeText
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((f) => f.length >= 7 && f[1] === "00000000")
    .sort((a, b) => Number(a[6]) - Number(b[6]));
  return routes[0]?.[0] ?? null;
}

/**
 * Which interface to show: the configured one, else the default route's,
 * else the busiest that is not loopback or a container bridge.
 */
export function pickInterface(
  counters: Map<string, NetCounters>,
  wanted: string | undefined,
  routed: string | null,
): string | null {
  if (wanted) return counters.has(wanted) ? wanted : null;
  if (routed && counters.has(routed)) return routed;
  const physical = [...counters.entries()].filter(([name]) => !/^(lo|docker|br-|veth|virbr|tun|tap)/.test(name));
  physical.sort(([, a], [, b]) => b.rx + b.tx - (a.rx + a.tx));
  return physical[0]?.[0] ?? null;
}

/** Bytes per second between two counter readings; a reset counter reads as 0. */
export function rate(prev: number, next: number, seconds: number): number {
  if (seconds <= 0 || next < prev) return 0;
  return (next - prev) / seconds;
}

/** One hwmon chip or thermal zone and what it read. */
export interface SensorChip {
  name: string;
  readings: { label: string | null; celsius: number }[];
}

/** Driver names turned into what a person would call the part. */
const CHIP_NAMES: [RegExp, string][] = [
  [/^(coretemp|k10temp|zenpower|cpu[-_]thermal|x86_pkg_temp|soc[-_]thermal)$/, "CPU"],
  [/^nvme/, "NVMe"],
  [/^(amdgpu|nouveau|radeon|gpu[-_]thermal)$/, "GPU"],
  [/^drivetemp$/, "Drive"],
  [/^acpitz$/, "Board"],
  [/^pch_/, "Chipset"],
  [/^(nct|it8|w83)/, "Motherboard"],
  [/^iwlwifi/, "Wi-Fi"],
];

/**
 * One row per chip - its hottest reading - named for the part. A desktop CPU
 * alone reports a sensor per core, which would bury the drives and the board
 * on a wall panel; the hottest core is the one worth watching.
 */
export function summariseSensors(chips: SensorChip[]): SystemTemp[] {
  const seen = new Map<string, number>();
  const out: SystemTemp[] = [];
  for (const chip of chips) {
    // Unwired sensors read 0, -273 or absurd values; they are not information.
    const valid = chip.readings.filter((r) => r.celsius > 0 && r.celsius < 150);
    if (valid.length === 0) continue;
    const hottest = Math.max(...valid.map((r) => r.celsius));
    const base = CHIP_NAMES.find(([pattern]) => pattern.test(chip.name))?.[1] ?? chip.name;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    out.push({ label: count === 1 ? base : `${base} ${count}`, celsius: Math.round(hottest * 10) / 10 });
  }
  return out.sort((a, b) => b.celsius - a.celsius);
}

/** One process from /proc/[pid]/stat. */
export interface ProcessStat {
  name: string;
  /** Distinguishes a process from a later one given the same pid. */
  startTime: number;
  /** User plus system time, in clock ticks. */
  ticks: number;
  /** Resident set size, in pages. */
  rssPages: number;
}

/**
 * /proc/[pid]/stat. The name is in parentheses and may itself hold spaces or
 * parentheses, so the fields are counted from the last ")".
 */
export function parseProcessStat(text: string): ProcessStat | null {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open === -1 || close < open) return null;
  // Field 3 (state) is the first after the name, so field n is at n - 3.
  const fields = text.slice(close + 1).trim().split(/\s+/);
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  const startTime = Number(fields[19]);
  const rssPages = Number(fields[21]);
  if ([utime, stime, startTime, rssPages].some(Number.isNaN)) return null;
  return { name: text.slice(open + 1, close), startTime, ticks: utime + stime, rssPages: Math.max(rssPages, 0) };
}

/** "KernelPageSize: 4 kB" from /proc/[pid]/smaps, in bytes. */
export function parsePageSize(smaps: string): number | null {
  const match = /^KernelPageSize:\s+(\d+) kB/m.exec(smaps);
  return match ? Number(match[1]) * 1024 : null;
}

/**
 * What a program is called, whichever instance: kernel threads carry their
 * CPU and queue after a slash ("kworker/3:1-events"), which would otherwise
 * split one thing into dozens of rows.
 */
const programName = (name: string) => name.replace(/\/.*$/, "") || name;

/**
 * The programs using the most CPU and the most memory. Processes are gathered
 * by name - a browser or a database is many processes, and the wall cares
 * about the program - with CPU as a share of the whole machine between two
 * samples, so the rows add up towards the headline figure.
 *
 * `totalTicks` is the whole machine's elapsed ticks over the same interval,
 * from /proc/stat. A process not in `previous` started since, and counts only
 * from now on.
 */
export function topProcesses(
  previous: Map<string, ProcessStat>,
  current: Map<string, ProcessStat>,
  totalTicks: number,
  pageSize: number,
  limit: number,
): { cpu: SystemProcess[]; memory: SystemProcess[] } {
  const programs = new Map<string, SystemProcess>();
  for (const [key, proc] of current) {
    const before = previous.get(key);
    const ticks = before ? Math.max(proc.ticks - before.ticks, 0) : 0;
    const name = programName(proc.name);
    const program = programs.get(name) ?? { name, count: 0, cpu: 0, memory: 0 };
    program.count += 1;
    program.cpu += totalTicks > 0 ? (ticks / totalTicks) * 100 : 0;
    program.memory += proc.rssPages * pageSize;
    programs.set(name, program);
  }

  const all = [...programs.values()].map((p) => ({ ...p, cpu: Math.round(clamp(p.cpu, 0, 100) * 10) / 10 }));
  return {
    cpu: all
      .filter((p) => p.cpu > 0)
      .sort((a, b) => b.cpu - a.cpu || b.memory - a.memory)
      .slice(0, limit),
    // Kernel threads hold no memory of their own.
    memory: all
      .filter((p) => p.memory > 0)
      .sort((a, b) => b.memory - a.memory)
      .slice(0, limit),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
