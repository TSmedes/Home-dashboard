import { get } from "node:http";
import type { ContainerHealth, ContainerStatus } from "@home-dash/shared";

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

export function mapContainer(raw: DockerContainer): ContainerStatus {
  const status = raw.Status ?? "";
  return {
    // Names come back with a leading slash: "/jellyfin".
    name: (raw.Names?.[0] ?? "unnamed").replace(/^\//, ""),
    image: raw.Image ?? "",
    state: raw.State ?? "unknown",
    status,
    health: healthOf(status),
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
