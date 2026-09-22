import type { ContainerStatus, ServiceCheckResult, ServicesSnapshot } from "@home-dash/shared";

/** How a service reads at a glance. `warn` is up but not well: restarting, unhealthy, starting. */
export type ServiceState = "up" | "warn" | "down";

export interface ServiceRow {
  key: string;
  name: string;
  state: ServiceState;
  /** The short phrase beside the name. */
  detail: string;
  kind: "container" | "check";
}

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

const ORDER: Record<ServiceState, number> = { down: 0, warn: 1, up: 2 };

/** Every container and check as one list, problems first, then by name. */
export function serviceRows(data: ServicesSnapshot): ServiceRow[] {
  const rows: ServiceRow[] = [
    ...(data.containers ?? []).map((c) => ({
      key: `container:${c.name}`,
      name: c.name,
      state: containerState(c),
      detail: containerDetail(c),
      kind: "container" as const,
    })),
    ...data.checks.map((c) => ({
      key: `check:${c.id}`,
      name: c.name,
      state: (c.ok ? "up" : "down") as ServiceState,
      detail: checkDetail(c),
      kind: "check" as const,
    })),
  ];
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
}

/** "All 12 up", or "2 of 13 need a look". */
export function summary(rows: ServiceRow[]): string {
  const problems = rows.filter((r) => r.state !== "up").length;
  if (rows.length === 0) return "Nothing to watch yet";
  if (problems === 0) return rows.length === 1 ? "Up" : `All ${rows.length} up`;
  return `${problems} of ${rows.length} ${problems === 1 ? "needs" : "need"} a look`;
}
