import { get } from "node:http";
import type { ContainerHealth, ContainerPort, ContainerStatus } from "@home-dash/shared";

/**
 * Container states from the Docker Engine API, over its unix socket. Only
 * GET requests are ever made, but the socket itself grants full control of
 * Docker, so the README says so plainly.
 */

/** The fields of GET /containers/json that are used. */
export interface DockerContainer {
  Names?: string[];
  Image?: string;
  State?: string;
  Status?: string;
  Ports?: DockerPort[];
  Labels?: Record<string, string>;
}

/** A port as Docker reports it. PublicPort is absent when nothing is published. */
export interface DockerPort {
  IP?: string;
  PrivatePort?: number;
  PublicPort?: number;
  Type?: string;
}

export type DockerRequest = (path: string) => Promise<unknown>;

/** A GET over the socket, parsed as JSON. */
export function socketRequest(socketPath: string, timeoutMs = 5000): DockerRequest {
  return (path) =>
    new Promise((resolve, reject) => {
      const req = get({ socketPath, path, timeout: timeoutMs }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) return reject(new Error(`Docker answered ${res.statusCode}`));
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Docker sent something that is not JSON"));
          }
        });
      });
      req.on("timeout", () => req.destroy(new Error("Docker did not answer in time")));
      req.on("error", (err: NodeJS.ErrnoException) => reject(new Error(describe(err, socketPath))));
    });
}

function describe(err: NodeJS.ErrnoException, socketPath: string): string {
  if (err.code === "ENOENT") return `no Docker socket at ${socketPath}`;
  if (err.code === "EACCES") return `not allowed to read ${socketPath}; see DOCKER_GID in the README`;
  return err.message;
}

/** Docker only says a container's health inside its status phrase. */
export function healthOf(status: string): ContainerHealth {
  if (/\(healthy\)/.test(status)) return "healthy";
  if (/\(unhealthy\)/.test(status)) return "unhealthy";
  if (/\(health: starting\)/.test(status)) return "starting";
  return null;
}

/**
 * The ports you can actually type into a browser.
 *
 * Only published ports have a PublicPort, and Docker lists each one twice when
 * it is bound on both IPv4 and IPv6 - the address is the same either way, so
 * the pair collapses to one entry.
 */
export function publishedPorts(raw: DockerPort[] = []): ContainerPort[] {
  const byPort = new Map<string, ContainerPort>();
  for (const port of raw) {
    if (port.PublicPort === undefined) continue;
    const protocol = port.Type ?? "tcp";
    const key = `${port.PublicPort}/${protocol}`;
    if (byPort.has(key)) continue;
    byPort.set(key, { host: port.PublicPort, container: port.PrivatePort ?? port.PublicPort, protocol });
  }
  return [...byPort.values()].sort((a, b) => a.host - b.host || a.protocol.localeCompare(b.protocol));
}

export function mapContainer(raw: DockerContainer): ContainerStatus {
  const status = raw.Status ?? "";
  return {
    // Names come back with a leading slash: "/jellyfin".
    name: (raw.Names?.[0] ?? "unnamed").replace(/^\//, ""),
    image: raw.Image ?? "",
    state: raw.State ?? "unknown",
    status,
    health: healthOf(status),
    ports: publishedPorts(raw.Ports),
    project: raw.Labels?.["com.docker.compose.project"] || null,
  };
}

export async function listContainers(
  request: DockerRequest,
  filter: { include: string[]; exclude: string[] },
): Promise<ContainerStatus[]> {
  const raw = await request("/containers/json?all=1");
  if (!Array.isArray(raw)) throw new Error("Docker sent an unexpected answer");
  return (raw as DockerContainer[])
    .map(mapContainer)
    .filter((c) => filter.include.length === 0 || filter.include.includes(c.name))
    .filter((c) => !filter.exclude.includes(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}
