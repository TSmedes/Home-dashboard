import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCacheStore, PollingCache } from "./PollingCache.js";

const KEY = "weather";

function makeCache(now = { ms: 1_700_000_000_000 }) {
  const store = new MemoryCacheStore();
  const cache = new PollingCache({ store, now: () => now.ms });
  return { store, cache, now };
}

describe("PollingCache", () => {
  beforeEach(() => vi.useRealTimers());

  it("returns an empty envelope for a source that has never fetched", () => {
    const { cache } = makeCache();
    cache.register({ key: KEY, intervalMs: 1000, fetch: async () => "x" });
    const env = cache.get(KEY);
    expect(env).toMatchObject({ key: KEY, data: null, fetchedAt: null, stale: true, error: null });
  });

  it("serves fresh data after a successful fetch", async () => {
    const { cache, now } = makeCache();
    cache.register({ key: KEY, intervalMs: 1000, fetch: async () => ({ temp: 62 }) });

    const env = await cache.refresh(KEY);
    expect(env.data).toEqual({ temp: 62 });
    expect(env.stale).toBe(false);
    expect(env.error).toBeNull();
    expect(env.fetchedAt).toBe(new Date(now.ms).toISOString());
  });

  // The central resilience guarantee.
  it("keeps serving the last good data when a refresh fails", async () => {
    const { cache, now } = makeCache();
    let mode: "ok" | "fail" = "ok";
    cache.register({
      key: KEY,
      intervalMs: 1000,
      fetch: async () => {
        if (mode === "fail") throw new Error("ECONNREFUSED");
        return { temp: 62 };
      },
    });

    await cache.refresh(KEY);
    const goodAt = now.ms;

    mode = "fail";
    now.ms += 5_000;
    const env = await cache.refresh(KEY);

    expect(env.data).toEqual({ temp: 62 });
    expect(env.stale).toBe(true);
    expect(env.error?.message).toMatch(/ECONNREFUSED/);
    // fetchedAt still points at the last *successful* fetch, so the UI can say
    // exactly how old the number on the wall is.
    expect(env.fetchedAt).toBe(new Date(goodAt).toISOString());
  });

  it("reports a failure with no prior success as empty rather than pretending", async () => {
    const { cache } = makeCache();
    cache.register({ key: KEY, intervalMs: 1000, fetch: async () => { throw new Error("boom"); } });

    const env = await cache.refresh(KEY);
    expect(env.data).toBeNull();
    expect(env.stale).toBe(true);
    expect(env.error?.message).toMatch(/boom/);
  });

  it("clears the error and staleness once the source recovers", async () => {
    const { cache } = makeCache();
    let mode: "ok" | "fail" = "fail";
    cache.register({
      key: KEY,
      intervalMs: 1000,
      fetch: async () => {
        if (mode === "fail") throw new Error("down");
        return { temp: 70 };
      },
    });

    await cache.refresh(KEY);
    expect(cache.get(KEY).error).not.toBeNull();

    mode = "ok";
    const env = await cache.refresh(KEY);
    expect(env.data).toEqual({ temp: 70 });
    expect(env.stale).toBe(false);
    expect(env.error).toBeNull();
  });

  it("marks data stale once it ages past its tolerance, even without a failure", async () => {
    const { cache, now } = makeCache();
    cache.register({ key: KEY, intervalMs: 1000, fetch: async () => "v" });

    await cache.refresh(KEY);
    expect(cache.get(KEY).stale).toBe(false);

    now.ms += 10_000; // far beyond the staleness tolerance
    expect(cache.get(KEY).stale).toBe(true);
    expect(cache.get(KEY).data).toBe("v"); // still shown, just flagged
  });

  it("collapses concurrent refreshes of the same key into one fetch", async () => {
    const { cache } = makeCache();
    const fetch = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); return 1; });
    cache.register({ key: KEY, intervalMs: 1000, fetch });

    await Promise.all([cache.refresh(KEY), cache.refresh(KEY), cache.refresh(KEY)]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers on every refresh so the SSE stream stays in step", async () => {
    const { cache } = makeCache();
    const onUpdate = vi.fn();
    cache.subscribe(onUpdate);
    cache.register({ key: KEY, intervalMs: 1000, fetch: async () => 42 });

    await cache.refresh(KEY);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]![0]).toMatchObject({ key: KEY, data: 42, stale: false });
  });

  it("persists only successful fetches to the store", async () => {
    const { cache, store } = makeCache();
    let mode: "ok" | "fail" = "ok";
    cache.register({
      key: KEY,
      intervalMs: 1000,
      fetch: async () => {
        if (mode === "fail") throw new Error("nope");
        return { temp: 62 };
      },
    });

    await cache.refresh(KEY);
    expect(store.read(KEY)?.data).toEqual({ temp: 62 });

    mode = "fail";
    await cache.refresh(KEY);
    expect(store.read(KEY)?.data).toEqual({ temp: 62 }); // untouched by the failure
  });

  // Why the dashboard shows real numbers the instant it boots, not spinners.
  it("hydrates from the store on registration after a restart", () => {
    const store = new MemoryCacheStore();
    store.write(KEY, { data: { temp: 55 }, fetchedAt: new Date(1_700_000_000_000).toISOString() });

    const cache = new PollingCache({ store, now: () => 1_700_000_000_500 });
    cache.register({ key: KEY, intervalMs: 1000, fetch: async () => ({ temp: 99 }) });

    const env = cache.get(KEY);
    expect(env.data).toEqual({ temp: 55 });
    expect(env.fetchedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("polls on the configured interval once started", async () => {
    vi.useFakeTimers();
    const store = new MemoryCacheStore();
    const cache = new PollingCache({ store, now: () => Date.now() });
    const fetch = vi.fn(async () => 1);
    cache.register({ key: KEY, intervalMs: 1000, fetch });

    cache.start();
    await vi.advanceTimersByTimeAsync(3_500);
    cache.stop();

    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("stops polling after stop()", async () => {
    vi.useFakeTimers();
    const store = new MemoryCacheStore();
    const cache = new PollingCache({ store, now: () => Date.now() });
    const fetch = vi.fn(async () => 1);
    cache.register({ key: KEY, intervalMs: 1000, fetch });

    cache.start();
    await vi.advanceTimersByTimeAsync(2_500);
    const seen = fetch.mock.calls.length;
    cache.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetch.mock.calls.length).toBe(seen);
  });

  // Config edits re-create sources. The swap must not blank the tile, and must
  // not leave the old timer running alongside the new one.
  describe("re-registering an existing key", () => {
    it("keeps the last good data while switching to the new fetch", async () => {
      const { cache } = makeCache();
      cache.register({ key: KEY, intervalMs: 1000, fetch: async () => "old location" });
      await cache.refresh(KEY);

      cache.register({ key: KEY, intervalMs: 1000, fetch: async () => "new location" });
      expect(cache.get(KEY).data).toBe("old location"); // no flash of empty

      await cache.refresh(KEY);
      expect(cache.get(KEY).data).toBe("new location");
    });

    // The regression that froze widgets after a settings save: a fetch still
    // running at the moment of the swap left the new source believing it was
    // busy forever, so it never fetched again.
    it("does not let a fetch running during the swap block every later refresh", async () => {
      const { cache } = makeCache();
      let release!: () => void;
      const oldFetch = vi.fn(() => new Promise<string>((resolve) => (release = () => resolve("old"))));
      cache.register({ key: KEY, intervalMs: 1000, fetch: oldFetch });
      const inFlight = cache.refresh(KEY);

      const newFetch = vi.fn(async () => "new");
      cache.register({ key: KEY, intervalMs: 1000, fetch: newFetch });
      release();
      await inFlight;

      await cache.refresh(KEY);
      await cache.refresh(KEY);
      expect(newFetch).toHaveBeenCalledTimes(2);
      expect(cache.get(KEY).data).toBe("new");
    });

    it("ignores a result from the old source that arrives after the new one's", async () => {
      const { cache } = makeCache();
      const seen: unknown[] = [];
      cache.subscribe((envelope) => seen.push(envelope.data));
      let release!: () => void;
      cache.register({
        key: KEY,
        intervalMs: 1000,
        fetch: () => new Promise<string>((resolve) => (release = () => resolve("stale"))),
      });
      const slow = cache.refresh(KEY);

      cache.register({ key: KEY, intervalMs: 1000, fetch: async () => "fresh" });
      await cache.refresh(KEY);
      release();
      await slow;

      expect(cache.get(KEY).data).toBe("fresh");
      expect(seen.at(-1)).toBe("fresh"); // screens were not told the stale value last
    });

    it("replaces the polling timer instead of adding a second one", async () => {
      vi.useFakeTimers();
      const cache = new PollingCache({ store: new MemoryCacheStore(), now: () => Date.now() });
      const oldFetch = vi.fn(async () => 1);
      const newFetch = vi.fn(async () => 2);
      cache.register({ key: KEY, intervalMs: 1000, fetch: oldFetch });
      cache.start();

      cache.register({ key: KEY, intervalMs: 5000, fetch: newFetch });
      await vi.advanceTimersByTimeAsync(10_500);
      cache.stop();

      expect(oldFetch).not.toHaveBeenCalled();
      expect(newFetch).toHaveBeenCalledTimes(2); // every 5s, not every 1s
    });
  });

  describe("unregister", () => {
    it("stops polling and forgets the source", async () => {
      vi.useFakeTimers();
      const cache = new PollingCache({ store: new MemoryCacheStore(), now: () => Date.now() });
      const fetch = vi.fn(async () => 1);
      cache.register({ key: KEY, intervalMs: 1000, fetch });
      cache.start();

      cache.unregister(KEY);
      await vi.advanceTimersByTimeAsync(5_000);
      cache.stop();

      expect(fetch).not.toHaveBeenCalled();
      expect(cache.keys()).not.toContain(KEY);
      expect(() => cache.get(KEY)).toThrow(/not registered/i);
    });
  });

  it("throws on an unregistered key rather than silently returning nothing", () => {
    const { cache } = makeCache();
    expect(() => cache.get("nope")).toThrow(/not registered/i);
  });
});
