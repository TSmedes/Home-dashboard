import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHostReader, HISTORY_LENGTH, readTemps } from "./host.js";

/** A fake host: just enough of /proc, /sys and /etc to read. */
let root: string;

function put(path: string, text: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

const stat = (busy: number, idle: number) => `cpu  ${busy} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 0 0 0 0\ncpu1 0 0 0 0\n`;
const netDev = (rx: number, tx: number) =>
  `Inter-| Receive\n face |bytes\n  eth0: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0\n`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "home-dash-host-"));
  put("proc/stat", stat(100, 900));
  put("proc/meminfo", "MemTotal: 1000 kB\nMemAvailable: 250 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n");
  put("proc/loadavg", "1.00 0.50 0.25 1/100 999\n");
  put("proc/uptime", "3700.5 100.0\n");
  put("proc/net/dev", netDev(1000, 500));
  put("proc/net/route", "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\neth0\t00000000\t0\t3\t0\t0\t0\n");
  put("etc/hostname", "homelab\n");
  put("sys/class/hwmon/hwmon0/name", "k10temp\n");
  put("sys/class/hwmon/hwmon0/temp1_input", "61250\n");
  put("sys/class/hwmon/hwmon0/temp1_label", "Tctl\n");
  put("sys/class/hwmon/hwmon1/name", "nvme\n");
  put("sys/class/hwmon/hwmon1/temp1_input", "39850\n");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const paths = () => ({ root, proc: join(root, "proc"), sys: join(root, "sys") });
const system = { disks: [{ path: "/", name: "System" }, { path: "/nope", name: "Gone" }], tempWarn: 75, tempCrit: 90 };

describe("createHostReader", () => {
  it("reads the host and works out rates between two samples", async () => {
    let t = 0;
    const reader = createHostReader(paths(), system, () => t, async () => {
      // Between the first two samples, a second passes and the counters move.
      t += 1000;
      put("proc/stat", stat(150, 950));
      put("proc/net/dev", netDev(3000, 1500));
    });

    const snapshot = await reader.read();
    expect(snapshot.hostname).toBe("homelab");
    expect(snapshot.uptimeSeconds).toBe(3700);
    expect(snapshot.cpu).toEqual({ usage: 50, cores: 2, load: [1, 0.5, 0.25], history: [50] });
    expect(snapshot.memory.total).toBe(1024000);
    expect(snapshot.memory.used).toBe(768000);
    expect(snapshot.memory.history).toEqual([75]);
    expect(snapshot.network).toEqual({ iface: "eth0", rxBps: 2000, txBps: 1000, rxHistory: [2000], txHistory: [1000] });
    expect(snapshot.temps).toEqual([
      { label: "CPU", celsius: 61.3 },
      { label: "NVMe", celsius: 39.9 },
    ]);
  });

  it("reports a disk it cannot read rather than failing", async () => {
    const snapshot = await createHostReader(paths(), system, Date.now, async () => {}).read();
    expect(snapshot.disks[0]!.total).toBeGreaterThan(0);
    expect(snapshot.disks[1]).toEqual({ path: "/nope", name: "Gone", total: null, used: null, free: null });
  });

  it("uses the configured name and keeps a bounded history", async () => {
    let t = 0;
    const reader = createHostReader(paths(), { ...system, name: "The NAS" }, () => (t += 10_000), async () => {});
    let last;
    for (let i = 0; i < HISTORY_LENGTH + 5; i++) last = await reader.read();
    expect(last!.hostname).toBe("The NAS");
    expect(last!.cpu.history).toHaveLength(HISTORY_LENGTH);
  });
});

describe("readTemps", () => {
  it("falls back to thermal zones when there are no hwmon chips, as on a Pi", async () => {
    const pi = mkdtempSync(join(tmpdir(), "home-dash-pi-"));
    mkdirSync(join(pi, "class", "thermal", "thermal_zone0"), { recursive: true });
    writeFileSync(join(pi, "class", "thermal", "thermal_zone0", "type"), "cpu-thermal\n");
    writeFileSync(join(pi, "class", "thermal", "thermal_zone0", "temp"), "48312\n");
    expect(await readTemps(pi)).toEqual([{ label: "CPU", celsius: 48.3 }]);
    rmSync(pi, { recursive: true, force: true });
  });
});
