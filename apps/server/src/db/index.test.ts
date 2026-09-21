import { describe, expect, it } from "vitest";
import { PollingCache } from "../cache/PollingCache.js";
import { openDatabase, SqliteCacheStore, TokenStore } from "./index.js";

describe("SqliteCacheStore", () => {
  it("round-trips a structured value", () => {
    const store = new SqliteCacheStore(openDatabase(":memory:"));
    const entry = { data: { temp: 62, hourly: [1, 2, 3] }, fetchedAt: "2026-09-21T12:00:00.000Z" };
    store.write("weather", entry);
    expect(store.read("weather")).toEqual(entry);
  });

  it("returns undefined for an unknown key", () => {
    expect(new SqliteCacheStore(openDatabase(":memory:")).read("nope")).toBeUndefined();
  });

  it("overwrites rather than duplicating on repeated writes", () => {
    const store = new SqliteCacheStore(openDatabase(":memory:"));
    store.write("k", { data: 1, fetchedAt: "2026-09-21T12:00:00.000Z" });
    store.write("k", { data: 2, fetchedAt: "2026-09-21T12:05:00.000Z" });
    expect(store.read("k")?.data).toBe(2);
  });

  // The restart story, end to end against real SQLite.
  it("lets a new PollingCache hydrate from a previous process's data", async () => {
    const db = openDatabase(":memory:");
    const first = new PollingCache({ store: new SqliteCacheStore(db) });
    first.register({ key: "weather", intervalMs: 60_000, fetch: async () => ({ temp: 62 }) });
    await first.refresh("weather");

    const second = new PollingCache({ store: new SqliteCacheStore(db) });
    second.register({ key: "weather", intervalMs: 60_000, fetch: async () => ({ temp: 99 }) });

    expect(second.get("weather").data).toEqual({ temp: 62 });
  });
});

describe("TokenStore", () => {
  it("stores, reports and clears provider tokens", () => {
    const tokens = new TokenStore(openDatabase(":memory:"));
    expect(tokens.has("google")).toBe(false);

    tokens.set("google", { refresh_token: "abc", scope: "calendar" });
    expect(tokens.has("google")).toBe(true);
    expect(tokens.get<{ refresh_token: string }>("google")?.refresh_token).toBe("abc");

    tokens.clear("google");
    expect(tokens.has("google")).toBe(false);
  });

  it("replaces a token on re-auth instead of accumulating rows", () => {
    const tokens = new TokenStore(openDatabase(":memory:"));
    tokens.set("google", { refresh_token: "old" });
    tokens.set("google", { refresh_token: "new" });
    expect(tokens.get<{ refresh_token: string }>("google")?.refresh_token).toBe("new");
  });
});
