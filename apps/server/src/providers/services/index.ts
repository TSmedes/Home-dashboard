import type { DashboardConfig, ServicesSnapshot } from "@home-dash/shared";
import { listContainers, type DockerRequest } from "./docker.js";
import { runChecks } from "./httpChecks.js";

/**
 * Docker containers and URL checks together. Docker being unreachable is
 * reported inside the snapshot, next to whatever the checks found, rather
 * than thrown: the checks are still true.
 */
export async function fetchServices(
  services: DashboardConfig["services"],
  docker: DockerRequest | null,
  fetcher: typeof fetch = fetch,
): Promise<ServicesSnapshot> {
  const [containers, checks] = await Promise.all([
    docker
      ? listContainers(docker, services.docker).then(
          (list) => ({ list, error: null }),
          (err: unknown) => ({ list: null, error: err instanceof Error ? err.message : String(err) }),
        )
      : { list: null, error: null },
    runChecks(services.checks, fetcher),
  ]);
  return { containers: containers.list, dockerError: containers.error, checks };
}
