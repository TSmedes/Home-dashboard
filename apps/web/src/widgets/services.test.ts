import { describe, expect, it } from "vitest";
import type { ContainerStatus, ServicesSnapshot } from "@home-dash/shared";
import { containerAddress, portLabel, serviceRows, serviceTree, summary } from "./services.js";

const container = (name: string, over: Partial<ContainerStatus> = {}): ContainerStatus => ({
  name,
  image: `${name}:latest`,
  state: "running",
  status: "Up 3 days",
  health: null,
  ports: [],
  project: null,
  ...over,
});

const snapshot = (containers: ContainerStatus[], checks: ServicesSnapshot["checks"] = []): ServicesSnapshot => ({
  containers,
  dockerError: null,
  checks,
});

const HOST = "192.168.1.40";

describe("containerAddress", () => {
  it("uses the lowest published port, on the host the dashboard was reached at", () => {
    const c = container("firefly", {
      ports: [
        { host: 8080, container: 80, protocol: "tcp" },
        { host: 3000, container: 3000, protocol: "tcp" },
      ],
    });
    expect(containerAddress(c, HOST)).toBe("192.168.1.40:3000");
  });

  it("has no address when nothing is published", () => {
    expect(containerAddress(container("db"), HOST)).toBeNull();
  });

  it("has no address when the container is not running, since the port is not listening", () => {
    const stopped = container("backup", {
      state: "exited",
      ports: [{ host: 8080, container: 80, protocol: "tcp" }],
    });
    expect(containerAddress(stopped, HOST)).toBeNull();
  });

  it("says so when the port is udp, and stays quiet when it is tcp", () => {
    expect(portLabel({ host: 53, container: 53, protocol: "udp" }, HOST)).toBe("192.168.1.40:53/udp");
    expect(portLabel({ host: 80, container: 80, protocol: "tcp" }, HOST)).toBe("192.168.1.40:80");
  });
});

describe("serviceTree", () => {
  const firefly = [
    container("firefly_iii_core", { project: "firefly", ports: [{ host: 8080, container: 8080, protocol: "tcp" }] }),
    container("firefly_iii_db", { project: "firefly" }),
    container("firefly_iii_cron", { project: "firefly" }),
    container("firefly_iii_importer", { project: "firefly" }),
  ];

  it("gathers containers sharing a compose project into one group", () => {
    const tree = serviceTree(snapshot(firefly), HOST);
    expect(tree).toHaveLength(1);
    const group = tree[0]!;
    expect(group.kind).toBe("group");
    if (group.kind !== "group") throw new Error("expected a group");
    expect(group.name).toBe("Firefly");
    expect(group.state).toBe("up");
    expect(group.detail).toBe("4 up");
    expect(group.members.map((m) => m.name)).toEqual([
      "firefly_iii_core",
      "firefly_iii_cron",
      "firefly_iii_db",
      "firefly_iii_importer",
    ]);
  });

  it("takes the group's state and wording from its worst member", () => {
    const withProblem = [...firefly.slice(1), container("firefly_iii_core", { project: "firefly", state: "exited" })];
    const group = serviceTree(snapshot(withProblem), HOST)[0]!;
    if (group.kind !== "group") throw new Error("expected a group");
    expect(group.state).toBe("down");
    expect(group.detail).toBe("3 up · 1 down");
    // Problems come first inside the group too.
    expect(group.members[0]!.name).toBe("firefly_iii_core");
  });

  it("leaves a one-container project alone rather than making a folder of one", () => {
    const tree = serviceTree(snapshot([container("jellyfin", { project: "jellyfin" })]), HOST);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.kind).toBe("container");
    expect(tree[0]!.name).toBe("jellyfin");
  });

  it("sorts groups among loose rows by state, then by name", () => {
    const tree = serviceTree(
      snapshot([...firefly, container("adguard"), container("zigbee", { state: "exited" })]),
      HOST,
    );
    expect(tree.map((n) => n.name)).toEqual(["zigbee", "adguard", "Firefly"]);
  });

  it("carries the address onto the row, and lists checks beside containers", () => {
    const tree = serviceTree(
      snapshot(
        [container("jellyfin", { ports: [{ host: 8096, container: 8096, protocol: "tcp" }] })],
        [{ id: "router", name: "Router", url: "http://10.0.0.1", ok: true, status: 200, latencyMs: 4, error: null }],
      ),
      HOST,
    );
    expect(tree.map((n) => n.name)).toEqual(["jellyfin", "Router"]);
    expect(tree[0]!.address).toBe("192.168.1.40:8096");
  });
});

describe("summary", () => {
  it("counts every container, grouped or not", () => {
    const rows = serviceRows(
      snapshot([
        container("firefly_iii_core", { project: "firefly" }),
        container("firefly_iii_db", { project: "firefly", state: "exited" }),
        container("jellyfin"),
      ]),
    );
    expect(summary(rows)).toBe("1 of 3 needs a look");
  });
});
