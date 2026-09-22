import type { ContainerPort, ContainerStatus, ServiceCheckResult, ServicesSnapshot } from "@home-dash/shared";

/** How a service reads at a glance. `warn` is up but not well: restarting, unhealthy, starting. */
export type ServiceState = "up" | "warn" | "down";

interface ServiceNodeBase {
  key: string;
  name: string;
  state: ServiceState;
  /** The short phrase beside the name. */
  detail: string;
  /** Where to reach it, when it publishes a port. */
  address: string | null;
}

export interface ServiceRow extends ServiceNodeBase {
  kind: "container" | "check";
}

/** A compose stack: several containers that are really one service. */
export interface ServiceGroup extends ServiceNodeBase {
  kind: "group";
  address: null;
  members: ServiceRow[];
}

export type ServiceNode = ServiceRow | ServiceGroup;

export function containerState(c: ContainerStatus): ServiceState {
  if (c.state === "running") return c.health === "unhealthy" ? "down" : c.health === "starting" ? "warn" : "up";
  if (c.state === "restarting" || c.state === "paused") return "warn";
  return "down";
}

/** Docker's phrase, trimmed of the health note the dot already shows. */
function containerDetail(c: ContainerStatus): string {
  if (c.health === "unhealthy") return "Unhealthy";
  return c.status.replace(/\s*\((healthy|unhealthy|health: starting)\)/, "") || c.state;
}

function checkDetail(c: ServiceCheckResult): string {
  if (c.ok) return c.latencyMs !== null ? `${c.latencyMs} ms` : "Up";
  return c.error ?? "Down";
}

/**
 * One published port as an address you can type.
 *
 * Docker reports the binding as 0.0.0.0, which is not somewhere you can go, so
 * the host comes from the browser instead - whatever the iPad used to reach the
 * dashboard also reaches the containers beside it.
 */
export function portLabel(port: ContainerPort, hostname: string): string {
  return `${hostname}:${port.host}${port.protocol === "udp" ? "/udp" : ""}`;
}

/**
 * Where to reach a container, or null if there is nowhere to go: a container
 * that publishes nothing, or one that is not running so nothing is listening.
 */
export function containerAddress(c: ContainerStatus, hostname: string): string | null {
  if (c.state !== "running" || c.ports.length === 0) return null;
  const lowest = c.ports.reduce((low, port) => (port.host < low.host ? port : low));
  return portLabel(lowest, hostname);
}

const ORDER: Record<ServiceState, number> = { down: 0, warn: 1, up: 2 };

const byStateThenName = (a: ServiceNodeBase, b: ServiceNodeBase) =>
  ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name);

function containerRow(c: ContainerStatus, hostname: string): ServiceRow {
  return {
    key: `container:${c.name}`,
    name: c.name,
    state: containerState(c),
    detail: containerDetail(c),
    address: containerAddress(c, hostname),
    kind: "container",
  };
}

function checkRow(c: ServiceCheckResult): ServiceRow {
  return {
    key: `check:${c.id}`,
    name: c.name,
    state: c.ok ? "up" : "down",
    detail: checkDetail(c),
    address: null,
    kind: "check",
  };
}

/** "4 up", or "3 up · 1 down" when some of the stack needs a look. */
function groupDetail(members: ServiceRow[]): string {
  const count = (state: ServiceState) => members.filter((m) => m.state === state).length;
  const parts = [
    count("up") > 0 && `${count("up")} up`,
    count("warn") > 0 && `${count("warn")} degraded`,
    count("down") > 0 && `${count("down")} down`,
  ].filter((part): part is string => part !== false);
  return parts.join(" · ");
}

/** A compose project's name, as a heading: "firefly" reads as "Firefly". */
function groupName(project: string): string {
  return project.charAt(0).toUpperCase() + project.slice(1);
}

/**
 * Every container and check as one list, problems first, then by name.
 *
 * Flat, with no grouping: this is what the summary counts, so a stack's four
 * containers count as four whether they are shown as one row or not.
 */
export function serviceRows(data: ServicesSnapshot, hostname = ""): ServiceRow[] {
  const rows: ServiceRow[] = [
    ...(data.containers ?? []).map((c) => containerRow(c, hostname)),
    ...data.checks.map(checkRow),
  ];
  return rows.sort(byStateThenName);
}

/**
 * The same services, with each compose stack gathered under one heading.
 *
 * Only a project with two or more containers becomes a group - a stack of one
 * is just a service, and a folder holding it would say nothing.
 */
export function serviceTree(data: ServicesSnapshot, hostname = ""): ServiceNode[] {
  const containers = data.containers ?? [];
  const projects = new Map<string, ContainerStatus[]>();
  for (const c of containers) {
    if (!c.project) continue;
    const kin = projects.get(c.project);
    if (kin) kin.push(c);
    else projects.set(c.project, [c]);
  }

  const grouped = new Set<string>();
  const nodes: ServiceNode[] = [];
  for (const [project, members] of projects) {
    if (members.length < 2) continue;
    for (const c of members) grouped.add(c.name);
    const rows = members.map((c) => containerRow(c, hostname)).sort(byStateThenName);
    nodes.push({
      kind: "group",
      key: `group:${project}`,
      name: groupName(project),
      state: rows.reduce<ServiceState>((worst, r) => (ORDER[r.state] < ORDER[worst] ? r.state : worst), "up"),
      detail: groupDetail(rows),
      address: null,
      members: rows,
    });
  }

  for (const c of containers) {
    if (!grouped.has(c.name)) nodes.push(containerRow(c, hostname));
  }
  nodes.push(...data.checks.map(checkRow));

  return nodes.sort(byStateThenName);
}

/** "All 12 up", or "2 of 13 need a look". */
export function summary(rows: ServiceRow[]): string {
  const problems = rows.filter((r) => r.state !== "up").length;
  if (rows.length === 0) return "Nothing to watch yet";
  if (problems === 0) return rows.length === 1 ? "Up" : `All ${rows.length} up`;
  return `${problems} of ${rows.length} ${problems === 1 ? "needs" : "need"} a look`;
}
