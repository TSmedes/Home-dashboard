import type { PiholeSnapshot } from "@home-dash/shared";
import { dateKeyInZone, zonedMidnight } from "../../lib/zonedTime.js";
import { ProviderAuthError } from "../types.js";

/**
 * Pi-hole v6, through its REST API. Every stats call needs a session, got by
 * posting the password to /api/auth. Pi-hole allows only a handful of open
 * sessions, so one is kept and reused, and a fresh one is asked for only when
 * Pi-hole says the old one has expired.
 *
 * The password is never put into an error message.
 */

const TIMEOUT_MS = 5000;
/** How many domains and clients the full-screen view lists. */
const TOP = 10;

interface AuthResponse {
  session?: { valid?: boolean; sid?: string | null };
}

interface BlockingResponse {
  blocking?: string;
  timer?: number | null;
}

interface SummaryResponse {
  queries?: { unique_domains?: number };
  clients?: { active?: number; total?: number };
  gravity?: { domains_being_blocked?: number; last_update?: number };
}

export interface ExtrasResponse {
  topDomains?: { domains?: { domain: string; count: number }[] };
  topClients?: { clients?: { name?: string; ip: string; count: number }[] };
  upstreams?: {
    upstreams?: { name?: string | null; ip?: string | null; port?: number; count: number; statistics?: { response?: number } }[];
  };
}

/** Ten-minute buckets over the last day; timestamps are Unix seconds. */
interface HistoryResponse {
  history?: { timestamp: number; total?: number; blocked?: number }[];
}

export interface Pihole {
  read(timezone: string, now?: Date): Promise<PiholeSnapshot>;
}

export function createPihole(
  settings: { url: string; password: string },
  fetcher: typeof fetch = fetch,
): Pihole {
  const base = settings.url.replace(/\/+$/, "");
  let sid: string | null = null;
  let login: Promise<string | null> | null = null;

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetcher(`${base}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`Pi-hole: ${reason(err)}`);
    }
  }

  /** One login at a time, however many reads are waiting on it. */
  function authenticate(): Promise<string | null> {
    login ??= (async () => {
      const res = await call("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: settings.password }),
      });
      if (res.status === 401) throw new ProviderAuthError("pihole", "Pi-hole rejected the password; check PIHOLE_PASSWORD");
      if (res.status === 429) throw new Error("Pi-hole has no free sessions; try again shortly");
      if (!res.ok) throw new Error(`Pi-hole answered ${res.status} to the login`);
      const body = (await res.json()) as AuthResponse;
      if (!body.session?.valid) throw new ProviderAuthError("pihole", "Pi-hole rejected the password; check PIHOLE_PASSWORD");
      // A Pi-hole with no password set hands out no session and needs none.
      return body.session.sid ?? null;
    })().finally(() => {
      login = null;
    });
    return login;
  }

  async function get<T>(path: string): Promise<T> {
    if (sid === null) sid = await authenticate();
    let res = await call(path, { headers: sid ? { "X-FTL-SID": sid } : {} });
    if (res.status === 401) {
      await res.arrayBuffer().catch(() => undefined);
      sid = await authenticate();
      res = await call(path, { headers: sid ? { "X-FTL-SID": sid } : {} });
    }
    if (!res.ok) throw new Error(`Pi-hole answered ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  return {
    async read(timezone, now = new Date()) {
      // The first call logs in; the rest reuse its session.
      const blocking = await get<BlockingResponse>("/api/dns/blocking");
      const [summary, history, topDomains, topClients, upstreams] = await Promise.all([
        get<SummaryResponse>("/api/stats/summary"),
        get<HistoryResponse>("/api/history"),
        get<ExtrasResponse["topDomains"]>(`/api/stats/top_domains?blocked=true&count=${TOP}`),
        get<ExtrasResponse["topClients"]>(`/api/stats/top_clients?count=${TOP}`),
        get<ExtrasResponse["upstreams"]>("/api/stats/upstreams"),
      ]);
      const midnight = zonedMidnight(dateKeyInZone(now, timezone), timezone);
      return toSnapshot(blocking, summary, history, midnight, { topDomains, topClients, upstreams });
    },
  };
}

/**
 * Pi-hole's own summary covers the last 24 hours, not today, so today's
 * counts are summed from the history buckets that start after midnight.
 */
export function toSnapshot(
  blocking: BlockingResponse,
  summary: SummaryResponse,
  history: HistoryResponse,
  midnight: Date,
  extras: ExtrasResponse = {},
): PiholeSnapshot {
  const since = midnight.getTime() / 1000;
  let queriesToday = 0;
  let blockedToday = 0;
  const today: PiholeSnapshot["history"] = [];
  for (const bucket of history.history ?? []) {
    if (bucket.timestamp < since) continue;
    const total = bucket.total ?? 0;
    const blocked = bucket.blocked ?? 0;
    queriesToday += total;
    blockedToday += blocked;
    today.push({ at: new Date(bucket.timestamp * 1000).toISOString(), total, blocked });
  }
  const state = blocking.blocking;
  const updated = summary.gravity?.last_update;
  return {
    blocking: state === "enabled" || state === "disabled" || state === "failed" ? state : "unknown",
    blockingTimer: typeof blocking.timer === "number" ? Math.round(blocking.timer) : null,
    activeClients: summary.clients?.active ?? 0,
    totalClients: summary.clients?.total ?? 0,
    queriesToday,
    blockedToday,
    percentBlocked: queriesToday > 0 ? (blockedToday / queriesToday) * 100 : 0,
    domainsOnList: summary.gravity?.domains_being_blocked ?? 0,
    listsUpdated: updated ? new Date(updated * 1000).toISOString() : null,
    history: today,
    topBlocked: (extras.topDomains?.domains ?? []).map((d) => ({ name: d.domain, count: d.count })),
    // A client with no hostname is known only by its address.
    topClients: (extras.topClients?.clients ?? []).map((c) => ({ name: c.name || c.ip, ip: c.ip, count: c.count })),
    upstreams: (extras.upstreams?.upstreams ?? [])
      .filter((u) => u.count > 0)
      .map((u) => {
        const ip = u.ip ?? "";
        // "blocklist" and "cache" are Pi-hole answering by itself, with no port.
        const asked = (u.port ?? -1) > 0;
        return {
          name: asked ? u.name || ip : ip === "cache" ? "Cache" : ip === "blocklist" ? "Blocklist" : u.name || ip,
          ip: asked ? `${ip}${u.port === 53 ? "" : `#${u.port}`}` : "",
          count: u.count,
          responseMs: asked && u.statistics?.response ? Math.round(u.statistics.response * 1000) : null,
        };
      })
      .sort((a, b) => b.count - a.count),
    uniqueDomains: summary.queries?.unique_domains ?? 0,
  };
}

function reason(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "no answer in 5 s";
    const cause = err.cause as (NodeJS.ErrnoException & { errors?: NodeJS.ErrnoException[] }) | undefined;
    const code = cause?.code ?? cause?.errors?.[0]?.code;
    if (code === "ECONNREFUSED") return "connection refused";
    if (code === "ENOTFOUND") return "host not found";
    if (code === "EHOSTUNREACH") return "host unreachable";
    return cause?.message || err.message;
  }
  return String(err);
}
