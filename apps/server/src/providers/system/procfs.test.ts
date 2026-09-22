import { describe, expect, it } from "vitest";
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
} from "./procfs.js";

// Captured from a 4-core Debian 12 box, trimmed.
const STAT = `cpu  10132153 290696 3084719 46828483 16683 0 25195 0 175628 0
cpu0 1393280 32966 572056 13366640 2789 0 1011 0 0 0
cpu1 1335390 28733 384209 11240640 4436 0 12309 0 0 0
cpu2 3812155 116000 1062110 11222030 4799 0 7375 0 0 0
cpu3 3591328 112997 1066344 10999173 4659 0 4500 0 0 0
intr 1462898 0 0 0
ctxt 115315133
btime 1769000000
`;

const MEMINFO = `MemTotal:       16303592 kB
MemFree:         1234567 kB
MemAvailable:   10485760 kB
Buffers:          204800 kB
Cached:          6291456 kB
SwapTotal:       2097148 kB
SwapFree:        1048574 kB
`;

const NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 9047232   93216    0    0    0     0          0         0  9047232   93216    0    0    0     0       0          0
  eno1: 1983421903 1623451    0   12    0     0          0     2341 216354112  923841    0    0    0     0       0          0
docker0: 88123    1203    0    0    0     0          0         0 99912234   2301    0    0    0     0       0          0
`;

const ROUTE = `Iface	Destination	Gateway 	Flags	RefCnt	Use	Metric	Mask		MTU	Window	IRTT
eno1	00000000	0100000A	0003	0	0	100	00000000	0	0	0
eno1	0000000A	00000000	0001	0	0	100	00FFFFFF	0	0	0
docker0	000011AC	00000000	0001	0	0	0	0000FFFF	0	0	0
`;

describe("parseCpuStat", () => {
  it("counts cores and separates busy from idle and iowait", () => {
    const { times, cores } = parseCpuStat(STAT);
    expect(cores).toBe(4);
    expect(times.total).toBe(10132153 + 290696 + 3084719 + 46828483 + 16683 + 0 + 25195 + 0);
    expect(times.busy).toBe(times.total - 46828483 - 16683);
  });

  it("refuses text that is not /proc/stat", () => {
    expect(() => parseCpuStat("nonsense")).toThrow(/cpu line/);
  });
});

describe("cpuUsage", () => {
  it("is the share of elapsed ticks spent busy", () => {
    expect(cpuUsage({ busy: 100, total: 1000 }, { busy: 150, total: 1200 })).toBe(25);
  });

  it("reads 0 when no time has passed", () => {
    expect(cpuUsage({ busy: 1, total: 10 }, { busy: 1, total: 10 })).toBe(0);
  });
});

describe("parseMeminfo", () => {
  it("converts kB to bytes and uses MemAvailable", () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      total: 16303592 * 1024,
      available: 10485760 * 1024,
      swapTotal: 2097148 * 1024,
      swapFree: 1048574 * 1024,
    });
  });

  it("estimates available memory on kernels without MemAvailable", () => {
    const old = MEMINFO.replace(/MemAvailable.*\n/, "");
    expect(parseMeminfo(old).available).toBe((1234567 + 204800 + 6291456) * 1024);
  });
});

describe("small files", () => {
  it("reads the three load averages", () => {
    expect(parseLoadavg("0.52 0.58 0.59 1/467 12345\n")).toEqual([0.52, 0.58, 0.59]);
  });

  it("reads uptime in whole seconds", () => {
    expect(parseUptime("1052163.84 4003214.22\n")).toBe(1052163);
  });
});

describe("network", () => {
  const counters = parseNetDev(NET_DEV);

  it("reads received and sent bytes per interface", () => {
    expect(counters.get("eno1")).toEqual({ rx: 1983421903, tx: 216354112 });
    expect(counters.get("docker0")).toEqual({ rx: 88123, tx: 99912234 });
  });

  it("finds the interface with the default route", () => {
    expect(defaultInterface(ROUTE)).toBe("eno1");
    expect(defaultInterface("Iface\tDestination\n")).toBeNull();
  });

  it("prefers the configured interface, then the routed one, then the busiest physical one", () => {
    expect(pickInterface(counters, "docker0", "eno1")).toBe("docker0");
    expect(pickInterface(counters, "wlan9", "eno1")).toBeNull();
    expect(pickInterface(counters, undefined, "eno1")).toBe("eno1");
    expect(pickInterface(counters, undefined, null)).toBe("eno1");
  });

  it("turns counter deltas into a rate, and a reset counter into 0", () => {
    expect(rate(1000, 6000, 10)).toBe(500);
    expect(rate(6000, 1000, 10)).toBe(0);
  });
});

describe("summariseSensors", () => {
  it("names each part, keeps its hottest sensor and sorts hottest first", () => {
    const temps = summariseSensors([
      { name: "acpitz", readings: [{ label: null, celsius: 27.8 }] },
      {
        name: "coretemp",
        readings: [
          { label: "Package id 0", celsius: 52 },
          { label: "Core 0", celsius: 49 },
          { label: "Core 1", celsius: 55 },
        ],
      },
      { name: "nvme", readings: [{ label: "Composite", celsius: 38.85 }] },
      { name: "nvme", readings: [{ label: "Composite", celsius: 41 }] },
    ]);
    expect(temps).toEqual([
      { label: "CPU", celsius: 55 },
      { label: "NVMe 2", celsius: 41 },
      { label: "NVMe", celsius: 38.9 },
      { label: "Board", celsius: 27.8 },
    ]);
  });

  it("drops sensors that are not wired up", () => {
    expect(summariseSensors([{ name: "nct6798", readings: [{ label: null, celsius: -62 }] }])).toEqual([]);
  });
});
