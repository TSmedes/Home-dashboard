import { describe, expect, it } from "vitest";
import { createPihole, toSnapshot } from "./index.js";

const SUMMARY = {
  queries: { unique_domains: 589 },
  clients: { active: 7, total: 12 },
  gravity: { domains_being_blocked: 120000, last_update: 1790197342 },
};
// The shapes of /api/stats/top_domains, top_clients and upstreams, trimmed.
const EXTRAS = {
  topDomains: { domains: [{ domain: "ads.example", count: 209 }] },
  topClients: { clients: [{ name: "MacBookPro.lan", ip: "10.0.0.201", count: 2585 }, { name: "", ip: "10.0.0.9", count: 3 }] },
  upstreams: {
    upstreams: [
      { ip: "blocklist", name: "blocklist", port: -1, count: 794, statistics: { response: 0 } },
      { ip: "cache", name: "cache", port: -1, count: 1750, statistics: { response: 0 } },
      { ip: "8.8.8.8", name: "dns.google", port: 53, count: 433, statistics: { response: 0.0566 } },
      { ip: "10.0.0.1", name: null, port: 5353, count: 0, statistics: { response: 0 } },
    ],
  },
};
// 10:00 on 2026-09-23 in Los Angeles; midnight there is 07:00 UTC.
const NOW = new Date("2026-09-23T17:00:00Z");
const MIDNIGHT = Date.parse("2026-09-23T07:00:00Z") / 1000;
const HISTORY = {
  history: [
    { timestamp: MIDNIGHT - 600, total: 1000, blocked: 900 }, // yesterday
    { timestamp: MIDNIGHT, total: 100, blocked: 10 },
    { timestamp: MIDNIGHT + 600, total: 300, blocked: 30 },
  ],
};

/** A fake Pi-hole that hands out sessions and can be told to expire them. */
function fakePihole(password = "secret") {
  const valid = new Set<string>();
  let next = 0;
  const log: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    log.push(path);
    if (path === "/api/auth") {
      const body = JSON.parse(String(init?.body)) as { password: string };
      if (body.password !== password) return Response.json({ error: { key: "unauthorized" } }, { status: 401 });
      const sid = `sid-${++next}`;
      valid.add(sid);
      return Response.json({ session: { valid: true, sid } });
    }
    const sid = new Headers(init?.headers).get("X-FTL-SID");
    if (!sid || !valid.has(sid)) return Response.json({ error: { key: "unauthorized" } }, { status: 401 });
    if (path === "/api/dns/blocking") return Response.json({ blocking: "enabled" });
    if (path === "/api/stats/summary") return Response.json(SUMMARY);
    if (path === "/api/history") return Response.json(HISTORY);
    if (path === "/api/stats/top_domains") return Response.json(EXTRAS.topDomains);
    if (path === "/api/stats/top_clients") return Response.json(EXTRAS.topClients);
    if (path === "/api/stats/upstreams") return Response.json(EXTRAS.upstreams);
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fetcher, log, expireAll: () => valid.clear() };
}

describe("toSnapshot", () => {
  it("counts only the buckets since local midnight", () => {
    const snap = toSnapshot({ blocking: "enabled" }, SUMMARY, HISTORY, new Date(MIDNIGHT * 1000));
    expect(snap).toMatchObject({
      blocking: "enabled",
      blockingTimer: null,
      activeClients: 7,
      totalClients: 12,
      queriesToday: 400,
      blockedToday: 40,
      percentBlocked: 10,
      domainsOnList: 120000,
      uniqueDomains: 589,
      listsUpdated: new Date(1790197342 * 1000).toISOString(),
    });
    expect(snap.history).toEqual([
      { at: new Date(MIDNIGHT * 1000).toISOString(), total: 100, blocked: 10 },
      { at: new Date((MIDNIGHT + 600) * 1000).toISOString(), total: 300, blocked: 30 },
    ]);
  });

  it("names clients, domains and where answers came from", () => {
    const snap = toSnapshot({ blocking: "disabled", timer: 29.6 }, SUMMARY, HISTORY, new Date(MIDNIGHT * 1000), EXTRAS);
    expect(snap.blockingTimer).toBe(30);
    expect(snap.topBlocked).toEqual([{ name: "ads.example", count: 209 }]);
    // A client with no hostname falls back to its address.
    expect(snap.topClients.map((c) => c.name)).toEqual(["MacBookPro.lan", "10.0.0.9"]);
    // Busiest first; an upstream that answered nothing is left out.
    expect(snap.upstreams).toEqual([
      { name: "Cache", ip: "", count: 1750, responseMs: null },
      { name: "Blocklist", ip: "", count: 794, responseMs: null },
      { name: "dns.google", ip: "8.8.8.8", count: 433, responseMs: 57 },
    ]);
  });

  it("copes with an empty day and an unexpected blocking state", () => {
    const snap = toSnapshot({ blocking: "weird" }, {}, {}, new Date(MIDNIGHT * 1000));
    expect(snap).toMatchObject({
      blocking: "unknown",
      queriesToday: 0,
      percentBlocked: 0,
      activeClients: 0,
      listsUpdated: null,
      history: [],
      topBlocked: [],
      upstreams: [],
    });
  });
});

describe("createPihole", () => {
  const url = "http://pihole.test/";

  it("logs in once and reuses the session", async () => {
    const pi = fakePihole();
    const client = createPihole({ url, password: "secret" }, pi.fetcher);
    const snap = await client.read("America/Los_Angeles", NOW);
    await client.read("America/Los_Angeles", NOW);
    expect(snap.blockedToday).toBe(40);
    expect(snap.topClients[0]).toEqual({ name: "MacBookPro.lan", ip: "10.0.0.201", count: 2585 });
    expect(pi.log.filter((p) => p === "/api/auth")).toHaveLength(1);
  });

  it("logs in again when the session expires", async () => {
    const pi = fakePihole();
    const client = createPihole({ url, password: "secret" }, pi.fetcher);
    await client.read("America/Los_Angeles", NOW);
    pi.expireAll();
    const snap = await client.read("America/Los_Angeles", NOW);
    expect(snap.activeClients).toBe(7);
    expect(pi.log.filter((p) => p === "/api/auth")).toHaveLength(2);
  });

  it("says the password is wrong without repeating it", async () => {
    const pi = fakePihole();
    const client = createPihole({ url, password: "hunter2" }, pi.fetcher);
    const err = await client.read("America/Los_Angeles", NOW).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/PIHOLE_PASSWORD/);
    expect((err as Error).message).not.toContain("hunter2");
  });

  it("turns a refused connection into a plain reason", async () => {
    const fetcher = (async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ECONNREFUSED" }) });
    }) as typeof fetch;
    const client = createPihole({ url, password: "secret" }, fetcher);
    await expect(client.read("America/Los_Angeles", NOW)).rejects.toThrow("Pi-hole: connection refused");
  });
});
