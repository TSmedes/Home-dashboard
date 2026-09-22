import { describe, expect, it, vi } from "vitest";
import { healthOf, listContainers, mapContainer, type DockerContainer } from "./docker.js";
import { runCheck } from "./httpChecks.js";
import { fetchServices } from "./index.js";

// The shape of GET /containers/json?all=1, trimmed to the fields used.
const CONTAINERS: DockerContainer[] = [
  { Names: ["/jellyfin"], Image: "jellyfin/jellyfin:latest", State: "running", Status: "Up 3 days (healthy)" },
  { Names: ["/pihole"], Image: "pihole/pihole", State: "running", Status: "Up 2 minutes (health: starting)" },
  { Names: ["/backup"], Image: "restic", State: "exited", Status: "Exited (1) 4 hours ago" },
  { Names: ["/home-dash"], Image: "home-dash:latest", State: "running", Status: "Up 5 hours" },
];

const docker = async () => CONTAINERS;
const noFilter = { include: [], exclude: [] };

describe("docker", () => {
  it("reads health out of the status phrase", () => {
    expect(healthOf("Up 3 days (healthy)")).toBe("healthy");
    expect(healthOf("Up 1 hour (unhealthy)")).toBe("unhealthy");
    expect(healthOf("Up 2 minutes (health: starting)")).toBe("starting");
    expect(healthOf("Up 5 hours")).toBeNull();
  });

  it("strips the leading slash Docker puts on names", () => {
    expect(mapContainer(CONTAINERS[0]!).name).toBe("jellyfin");
  });

  it("lists every container by name, filtered by include and exclude", async () => {
    expect((await listContainers(docker, noFilter)).map((c) => c.name)).toEqual([
      "backup",
      "home-dash",
      "jellyfin",
      "pihole",
    ]);
    expect((await listContainers(docker, { include: ["jellyfin", "pihole"], exclude: [] })).map((c) => c.name)).toEqual(
      ["jellyfin", "pihole"],
    );
    expect((await listContainers(docker, { include: [], exclude: ["home-dash"] })).map((c) => c.name)).not.toContain(
      "home-dash",
    );
  });

  it("asks for stopped containers too", async () => {
    const request = vi.fn(docker);
    await listContainers(request, noFilter);
    expect(request).toHaveBeenCalledWith("/containers/json?all=1");
  });
});

describe("runCheck", () => {
  const check = { id: "nas", name: "NAS", url: "http://nas.local" };

  it("counts any 2xx or 3xx as up and times it", async () => {
    let t = 0;
    const fetcher = vi.fn(async () => {
      t += 42;
      return new Response("", { status: 302 });
    });
    const result = await runCheck(check, fetcher as typeof fetch, () => t);
    expect(result).toEqual({ ...check, ok: true, status: 302, latencyMs: 42, error: null });
  });

  it("uses expectStatus when given", async () => {
    const fetcher = async () => new Response("", { status: 401 });
    expect((await runCheck({ ...check, expectStatus: 401 }, fetcher as typeof fetch)).ok).toBe(true);
    expect((await runCheck(check, fetcher as typeof fetch)).error).toBe("answered 401");
  });

  it("turns a refused connection into a plain reason", async () => {
    const fetcher = async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ECONNREFUSED" }) });
    };
    expect(await runCheck(check, fetcher as typeof fetch)).toEqual({
      ...check,
      ok: false,
      status: null,
      latencyMs: null,
      error: "connection refused",
    });
  });

  it("finds the reason when several addresses were tried", async () => {
    const refused = Object.assign(new Error("x"), { code: "ECONNREFUSED" });
    const fetcher = async () => {
      throw new TypeError("fetch failed", { cause: new AggregateError([refused, refused]) });
    };
    expect((await runCheck(check, fetcher as typeof fetch)).error).toBe("connection refused");
  });
});

describe("fetchServices", () => {
  const services = {
    docker: { enabled: true, ...noFilter },
    checks: [{ id: "router", name: "Router", url: "http://10.0.0.1" }],
  };
  const fetcher = (async () => new Response("", { status: 200 })) as typeof fetch;

  it("returns containers and checks together", async () => {
    const snapshot = await fetchServices(services, docker, fetcher);
    expect(snapshot.containers).toHaveLength(4);
    expect(snapshot.dockerError).toBeNull();
    expect(snapshot.checks[0]!.ok).toBe(true);
  });

  it("keeps the checks when Docker cannot be reached", async () => {
    const broken = async () => {
      throw new Error("no Docker socket at /var/run/docker.sock");
    };
    const snapshot = await fetchServices(services, broken, fetcher);
    expect(snapshot.containers).toBeNull();
    expect(snapshot.dockerError).toMatch(/no Docker socket/);
    expect(snapshot.checks).toHaveLength(1);
  });
});
