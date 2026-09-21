import type { WidgetEnvelope } from "@home-dash/shared";

export interface StoredEntry {
  data: unknown;
  /** ISO timestamp of the successful fetch that produced `data`. */
  fetchedAt: string;
}

/** Persistence seam. SQLite in production, memory in tests. */
export interface CacheStore {
  read(key: string): StoredEntry | undefined;
  write(key: string, entry: StoredEntry): void;
}

export class MemoryCacheStore implements CacheStore {
  readonly #entries = new Map<string, StoredEntry>();
  read(key: string): StoredEntry | undefined {
    return this.#entries.get(key);
  }
  write(key: string, entry: StoredEntry): void {
    this.#entries.set(key, entry);
  }
}

export interface SourceDefinition<T> {
  key: string;
  intervalMs: number;
  fetch: () => Promise<T>;
  /**
   * How long after a successful fetch the data is still considered fresh.
   * Defaults to 2.5x the interval, which tolerates a couple of missed polls
   * before the UI admits the number is old.
   */
  staleAfterMs?: number;
}

type Subscriber = (envelope: WidgetEnvelope<unknown>) => void;

interface SourceState {
  definition: SourceDefinition<unknown>;
  staleAfterMs: number;
  data: unknown;
  /** Epoch ms of the last successful fetch. */
  fetchedAt: number | null;
  error: { message: string; at: string } | null;
  inFlight: Promise<WidgetEnvelope<unknown>> | null;
  timer: NodeJS.Timeout | null;
}

/**
 * Polls registered data sources and caches their last good result.
 *
 * The invariant that matters: a failed fetch never destroys data. The previous
 * value keeps being served, flagged `stale` and carrying the error, so a dead
 * upstream degrades a single widget rather than emptying the dashboard. Values
 * are persisted so a restart repopulates instantly instead of showing spinners.
 */
export class PollingCache {
  readonly #store: CacheStore;
  readonly #now: () => number;
  readonly #sources = new Map<string, SourceState>();
  readonly #subscribers = new Set<Subscriber>();
  #running = false;

  constructor(opts: { store: CacheStore; now?: () => number }) {
    this.#store = opts.store;
    this.#now = opts.now ?? Date.now;
  }

  /**
   * Add a source, or swap the definition of one that already exists.
   *
   * A swap happens when config.yaml changes (a new location, a different bulb
   * address). It keeps the last good data so the tile does not blank, and it
   * replaces the polling timer rather than adding a second one beside it.
   */
  register<T>(definition: SourceDefinition<T>): void {
    const existing = this.#sources.get(definition.key);
    if (existing?.timer) clearInterval(existing.timer);

    const hydrated = existing ? undefined : this.#store.read(definition.key);
    this.#sources.set(definition.key, {
      definition: definition as SourceDefinition<unknown>,
      staleAfterMs: definition.staleAfterMs ?? definition.intervalMs * 2.5,
      data: existing ? existing.data : (hydrated?.data ?? null),
      fetchedAt: existing ? existing.fetchedAt : hydrated ? Date.parse(hydrated.fetchedAt) : null,
      error: existing?.error ?? null,
      // Never carried over: the old fetch's cleanup clears the *old* state, so a
      // copied promise would sit here forever and block every later refresh.
      inFlight: null,
      timer: null,
    });
    if (this.#running) this.#schedule(definition.key);
  }

  /** Stop polling a source that is no longer configured, and forget it. */
  unregister(key: string): void {
    const source = this.#sources.get(key);
    if (source?.timer) clearInterval(source.timer);
    this.#sources.delete(key);
  }

  subscribe(subscriber: Subscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => this.#subscribers.delete(subscriber);
  }

  keys(): string[] {
    return [...this.#sources.keys()];
  }

  get(key: string): WidgetEnvelope<unknown> {
    const source = this.#sources.get(key);
    if (!source) throw new Error(`cache source "${key}" is not registered`);
    return this.#envelope(key, source);
  }

  /** Fetch now, regardless of the interval. Concurrent calls share one fetch. */
  async refresh(key: string): Promise<WidgetEnvelope<unknown>> {
    const source = this.#sources.get(key);
    if (!source) throw new Error(`cache source "${key}" is not registered`);
    if (source.inFlight) return source.inFlight;

    source.inFlight = this.#run(key, source).finally(() => {
      source.inFlight = null;
    });
    return source.inFlight;
  }

  async refreshAll(): Promise<void> {
    await Promise.allSettled([...this.#sources.keys()].map((key) => this.refresh(key)));
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    for (const key of this.#sources.keys()) this.#schedule(key);
  }

  stop(): void {
    this.#running = false;
    for (const source of this.#sources.values()) {
      if (source.timer) clearInterval(source.timer);
      source.timer = null;
    }
  }

  /** Whether `source` has been swapped out (or dropped) since it started a fetch. */
  #superseded(key: string, source: SourceState): boolean {
    return this.#sources.get(key) !== source;
  }

  async #run(key: string, source: SourceState): Promise<WidgetEnvelope<unknown>> {
    try {
      const data = await source.definition.fetch();
      // Results for a replaced source are dropped: they came from the old
      // settings and could land after the new source's fresher data.
      if (this.#superseded(key, source)) return this.#current(key, source);
      const at = this.#now();
      source.data = data;
      source.fetchedAt = at;
      source.error = null;
      this.#store.write(key, { data, fetchedAt: new Date(at).toISOString() });
    } catch (cause) {
      if (this.#superseded(key, source)) return this.#current(key, source);
      // Deliberately leaves source.data and source.fetchedAt untouched.
      source.error = {
        message: cause instanceof Error ? cause.message : String(cause),
        at: new Date(this.#now()).toISOString(),
      };
    }

    const envelope = this.#envelope(key, source);
    for (const subscriber of this.#subscribers) subscriber(envelope);
    return envelope;
  }

  /** The live envelope for `key`, falling back to `source` if it was dropped. */
  #current(key: string, source: SourceState): WidgetEnvelope<unknown> {
    const live = this.#sources.get(key);
    return this.#envelope(key, live ?? source);
  }

  #schedule(key: string): void {
    const source = this.#sources.get(key);
    if (!source || source.timer) return;
    source.timer = setInterval(() => {
      void this.refresh(key);
    }, source.definition.intervalMs);
    source.timer.unref?.();
  }

  #envelope(key: string, source: SourceState): WidgetEnvelope<unknown> {
    const aged =
      source.fetchedAt === null || this.#now() - source.fetchedAt > source.staleAfterMs;
    return {
      key,
      data: source.data,
      fetchedAt: source.fetchedAt === null ? null : new Date(source.fetchedAt).toISOString(),
      stale: source.error !== null || aged,
      error: source.error,
    };
  }
}
