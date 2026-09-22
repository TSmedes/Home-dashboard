import type { ServicesSnapshot } from "@home-dash/shared";
import { describe, expect, it } from "vitest";
import { containerState, serviceRows, summary } from "./services.js";
import { formatBytes, formatRate, formatUptime, levelFor, seriesPath } from "./system.js";

describe("formatting", () => {
  it("writes sizes like df -h", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(8_375_000_000)).toBe("7.80 GB");
    expect(formatBytes(4_000_000_000_000)).toBe("3.64 TB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
  });

  it("writes network speed in bits, the way connections are sold", () => {
    expect(formatRate(0)).toBe("0 b/s");
    expect(formatRate(125_000)).toBe("1.00 Mb/s");
    expect(formatRate(117_500_000)).toBe("940 Mb/s");
  });

  it("writes uptime at the two largest units", () => {
    expect(formatUptime(8 * 60)).toBe("8 min");
    expect(formatUptime(5 * 3600 + 12 * 60)).toBe("5 h 12 min");
    expect(formatUptime(12 * 86400 + 4 * 3600)).toBe("12 days 4 h");
    expect(formatUptime(86400)).toBe("1 day 0 h");
  });
});

describe("levelFor", () => {
  it("steps at each threshold", () => {
    expect(levelFor(74, 75, 90)).toBe("ok");
    expect(levelFor(75, 75, 90)).toBe("warn");
    expect(levelFor(90, 75, 90)).toBe("crit");
  });
});

describe("seriesPath", () => {
  it("needs two points to draw a line", () => {
    expect(seriesPath([5], 100, 10)).toBeNull();
  });

  it("spreads points across the width with 0 at the bottom", () => {
    expect(seriesPath([0, 50, 100], 100, 10, 100)).toBe("M 0.0 10.0 L 50.0 5.0 L 100.0 0.0");
  });
});

describe("services", () => {
  const data: ServicesSnapshot = {
    containers: [
      { name: "jellyfin", image: "", state: "running", status: "Up 3 days (healthy)", health: "healthy" },
      { name: "backup", image: "", state: "exited", status: "Exited (1) 4 hours ago", health: null },
      { name: "pihole", image: "", state: "running", status: "Up 2 minutes (health: starting)", health: "starting" },
    ],
    dockerError: null,
    checks: [
      { id: "router", name: "Router", url: "", ok: true, status: 200, latencyMs: 12, error: null },
      { id: "nas", name: "NAS", url: "", ok: false, status: null, latencyMs: null, error: "connection refused" },
    ],
  };

  it("reads a container's state from Docker's state and health", () => {
    expect(containerState(data.containers![0]!)).toBe("up");
    expect(containerState(data.containers![1]!)).toBe("down");
    expect(containerState(data.containers![2]!)).toBe("warn");
    expect(containerState({ ...data.containers![0]!, health: "unhealthy" })).toBe("down");
  });

  it("lists problems first, each with a short detail", () => {
    const rows = serviceRows(data);
    expect(rows.map((r) => [r.name, r.state, r.detail])).toEqual([
      ["backup", "down", "Exited (1) 4 hours ago"],
      ["NAS", "down", "connection refused"],
      ["pihole", "warn", "Up 2 minutes"],
      ["jellyfin", "up", "Up 3 days"],
      ["Router", "up", "12 ms"],
    ]);
  });

  it("sums up in words", () => {
    expect(summary(serviceRows(data))).toBe("3 of 5 need a look");
    expect(summary(serviceRows({ containers: null, dockerError: null, checks: [data.checks[0]!] }))).toBe("Up");
    expect(summary([])).toBe("Nothing to watch yet");
  });
});
