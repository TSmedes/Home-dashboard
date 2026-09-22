import type { CommuteDestination, CommuteRoute, CommuteSnapshot, Location } from "@home-dash/shared";

/**
 * Drive times with live traffic from TomTom's Routing API. The free tier
 * (2,500 requests a day, no card) covers a couple of destinations polled
 * every ten minutes around the clock.
 *
 * The API key travels in the query string, so it is kept out of every error
 * message this module produces.
 */

const API = "https://api.tomtom.com/routing/1/calculateRoute";

interface TomTomSummary {
  lengthInMeters: number;
  travelTimeInSeconds: number;
  trafficDelayInSeconds: number;
  arrivalTime: string;
}

export interface TomTomResponse {
  routes?: { summary: TomTomSummary }[];
  detailedError?: { message?: string };
  error?: { description?: string };
}

export class TomTomAuthError extends Error {
  constructor() {
    super("TomTom rejected the API key; check TOMTOM_API_KEY or run npm run setup");
    this.name = "TomTomAuthError";
  }
}

export function routeUrl(origin: Location, destination: CommuteDestination, key: string): string {
  const url = new URL(`${API}/${origin.lat},${origin.lon}:${destination.lat},${destination.lon}/json`);
  url.searchParams.set("key", key);
  url.searchParams.set("traffic", "true");
  url.searchParams.set("travelMode", "car");
  url.searchParams.set("routeType", "fastest");
  url.searchParams.set("departAt", "now");
  return url.toString();
}

export function mapRoute(destination: CommuteDestination, raw: TomTomResponse): CommuteRoute {
  const summary = raw.routes?.[0]?.summary;
  if (!summary) throw new Error("TomTom found no route");
  return {
    id: destination.id,
    name: destination.name,
    travelSeconds: summary.travelTimeInSeconds,
    delaySeconds: Math.max(0, summary.trafficDelayInSeconds),
    lengthMeters: summary.lengthInMeters,
    arrival: new Date(summary.arrivalTime).toISOString(),
  };
}

async function route(
  origin: Location,
  destination: CommuteDestination,
  key: string,
  fetcher: typeof fetch,
): Promise<CommuteRoute> {
  let response: Response;
  try {
    response = await fetcher(routeUrl(origin, destination, key), { signal: AbortSignal.timeout(15_000) });
  } catch (cause) {
    // A network error can quote the URL, and the URL holds the key.
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(message.split(key).join("[key]"));
  }
  if (response.status === 401 || response.status === 403) throw new TomTomAuthError();
  const body = (await response.json().catch(() => ({}))) as TomTomResponse;
  if (!response.ok) {
    const detail = body.detailedError?.message ?? body.error?.description ?? `status ${response.status}`;
    throw new Error(`TomTom could not route there: ${detail.split(key).join("[key]")}`);
  }
  return mapRoute(destination, body);
}

/**
 * One destination failing - a pin dropped in the sea - still shows the rest.
 * Only when every destination fails, or the key is refused, does the whole
 * refresh fail and the widget fall back to its last good times.
 */
export async function fetchCommute(
  origin: Location,
  destinations: CommuteDestination[],
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<CommuteSnapshot> {
  const results = await Promise.allSettled(destinations.map((d) => route(origin, d, key, fetcher)));

  const auth = results.find((r) => r.status === "rejected" && r.reason instanceof TomTomAuthError);
  if (auth) throw (auth as PromiseRejectedResult).reason;

  const routes: CommuteRoute[] = [];
  const failed: CommuteSnapshot["failed"] = [];
  results.forEach((result, i) => {
    const destination = destinations[i]!;
    if (result.status === "fulfilled") routes.push(result.value);
    else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failed.push({ id: destination.id, name: destination.name, message });
    }
  });

  if (routes.length === 0 && failed.length > 0) throw new Error(failed.map((f) => `${f.name}: ${f.message}`).join("; "));
  return { routes, failed };
}
