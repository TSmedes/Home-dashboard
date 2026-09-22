import { readdir, readFile, statfs } from "node:fs/promises";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";
import type { DashboardConfig, SystemDisk, SystemSnapshot } from "@home-dash/shared";
import {
  cpuUsage,
  defaultInterface,
  parseCpuStat,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseUptime,
  pickInterface,
  rate,
  summariseSensors,
  type CpuTimes,
  type NetCounters,
  type SensorChip,
} from "./procfs.js";

/**
 * The machine the dashboard runs on, read straight from the kernel: no agent,
 * no dependency. In Docker the host's / is mounted read-only and the three
 * paths point into it, so the numbers are the host's rather than the
 * container's.
 */

export interface HostPaths {
  /** Prefix for host filesystem paths ("" on the host itself, /host in Docker). */
  root: string;
  proc: string;
  sys: string;
}

/** About ten minutes at the default ten-second refresh. */
export const HISTORY_LENGTH = 60;

/** On the very first read, how long to wait between the two samples a rate needs. */
const FIRST_SAMPLE_GAP_MS = 500;

interface Sample {
  at: number;
  cpu: CpuTimes;
  net: Map<string, NetCounters> | null;
}

export interface HostReader {
  read(): Promise<SystemSnapshot>;
}

export function createHostReader(
  paths: HostPaths,
  system: DashboardConfig["system"],
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): HostReader {
  let previous: Sample | null = null;
  const history = { cpu: [] as number[], memory: [] as number[], rx: [] as number[], tx: [] as number[] };

  const text = (path: string) => readFile(path, "utf8");

  async function sample(): Promise<Sample & { cores: number }> {
    const stat = parseCpuStat(await text(join(paths.proc, "stat")));
    return { at: now(), cpu: stat.times, cores: stat.cores, net: await readNet(paths.proc) };
  }

  return {
    async read() {
      if (!previous) {
        previous = await sample();
        await wait(FIRST_SAMPLE_GAP_MS);
      }
      const current = await sample();
      const seconds = (current.at - previous.at) / 1000;

      const [meminfo, load, uptime, temps, disks, hostname, route] = await Promise.all([
        text(join(paths.proc, "meminfo")).then(parseMeminfo),
        text(join(paths.proc, "loadavg")).then(parseLoadavg),
        text(join(paths.proc, "uptime")).then(parseUptime),
        readTemps(paths.sys),
        Promise.all(system.disks.map((d) => readDisk(paths.root, d.path, d.name))),
        system.name ?? readHostname(paths.root),
        readRoute(paths.proc),
      ]);

      const usage = round1(cpuUsage(previous.cpu, current.cpu));
      const used = meminfo.total - meminfo.available;
      push(history.cpu, usage);
      push(history.memory, round1((used / meminfo.total) * 100));

      let network: SystemSnapshot["network"] = null;
      const iface = current.net ? pickInterface(current.net, system.interface, route) : null;
      if (iface && current.net) {
        const next = current.net.get(iface)!;
        const prev = previous.net?.get(iface) ?? next;
        const rxBps = Math.round(rate(prev.rx, next.rx, seconds));
        const txBps = Math.round(rate(prev.tx, next.tx, seconds));
        push(history.rx, rxBps);
        push(history.tx, txBps);
        network = { iface, rxBps, txBps, rxHistory: [...history.rx], txHistory: [...history.tx] };
      }

      previous = current;
      return {
        hostname,
        uptimeSeconds: uptime,
        cpu: { usage, cores: current.cores, load, history: [...history.cpu] },
        memory: {
          total: meminfo.total,
          used,
          available: meminfo.available,
          swapTotal: meminfo.swapTotal,
          swapUsed: meminfo.swapTotal - meminfo.swapFree,
          history: [...history.memory],
        },
        temps,
        disks,
        network,
        sampledAt: new Date(current.at).toISOString(),
      };
    },
  };
}

function push(list: number[], value: number): void {
  list.push(value);
  if (list.length > HISTORY_LENGTH) list.splice(0, list.length - HISTORY_LENGTH);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * /proc/net is the reading process's network namespace, which in a container
 * is the container's. PID 1's view is the host's (as long as the container is
 * given the host's PID namespace or /proc/1 is readable), so try that first.
 */
async function readNet(proc: string): Promise<Map<string, NetCounters> | null> {
  for (const path of [join(proc, "1", "net", "dev"), join(proc, "net", "dev")]) {
    try {
      return parseNetDev(await readFile(path, "utf8"));
    } catch {
      // Not readable here; try the next.
    }
  }
  return null;
}

async function readRoute(proc: string): Promise<string | null> {
  for (const path of [join(proc, "1", "net", "route"), join(proc, "net", "route")]) {
    try {
      return defaultInterface(await readFile(path, "utf8"));
    } catch {
      // Not readable here; try the next.
    }
  }
  return null;
}

async function readHostname(root: string): Promise<string> {
  try {
    const name = (await readFile(join(root || "/", "etc", "hostname"), "utf8")).trim();
    if (name) return name;
  } catch {
    // Fall through to the process's own idea of it.
  }
  return osHostname();
}

async function readDisk(root: string, path: string, name: string): Promise<SystemDisk> {
  try {
    const s = await statfs(root ? join(root, path) : path);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    // Blocks reserved for root count as neither used nor free, as in df.
    const used = (s.blocks - s.bfree) * s.bsize;
    return { path, name, total, used, free };
  } catch {
    return { path, name, total: null, used: null, free: null };
  }
}

/** Every readable file in a directory, by name, or an empty list. */
async function list(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function maybe(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

/**
 * hwmon chips first - they cover CPUs, drives, NVMe and GPUs on most PCs -
 * falling back to thermal zones, which is all a Raspberry Pi has.
 */
export async function readTemps(sys: string): Promise<SystemSnapshot["temps"]> {
  const chips: SensorChip[] = [];
  const hwmon = join(sys, "class", "hwmon");
  for (const entry of await list(hwmon)) {
    const dir = join(hwmon, entry);
    const name = (await maybe(join(dir, "name"))) ?? entry;
    const inputs = (await list(dir)).filter((f) => /^temp\d+_input$/.test(f));
    const readings = [];
    for (const input of inputs) {
      const value = Number(await maybe(join(dir, input)));
      if (Number.isNaN(value)) continue;
      readings.push({ label: await maybe(join(dir, input.replace("_input", "_label"))), celsius: value / 1000 });
    }
    chips.push({ name, readings });
  }

  if (!chips.some((c) => c.readings.length > 0)) {
    const thermal = join(sys, "class", "thermal");
    for (const entry of (await list(thermal)).filter((e) => e.startsWith("thermal_zone"))) {
      const dir = join(thermal, entry);
      const value = Number(await maybe(join(dir, "temp")));
      if (Number.isNaN(value)) continue;
      chips.push({ name: (await maybe(join(dir, "type"))) ?? entry, readings: [{ label: null, celsius: value / 1000 }] });
    }
  }
  return summariseSensors(chips);
}
