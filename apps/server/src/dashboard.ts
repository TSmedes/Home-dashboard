import type { DashboardConfig, ProfileOverride } from "@home-dash/shared";
import { PollingCache } from "./cache/PollingCache.js";
import type { ConfigStore } from "./config/loader.js";
import type { TokenStore } from "./db/index.js";
import type { Env } from "./env.js";
import { nextBoundary, resolveActiveProfile } from "./profile/scheduler.js";
import { sourceFactories, type SourceFactory } from "./providers/index.js";
import type { StreamHub } from "./stream.js";

/** How often the active profile is re-evaluated. */
const PROFILE_TICK_MS = 30_000;

const OVERRIDE_KEY = "profileOverride";

/** Where the override is kept between restarts. SQLite in production. */
export interface OverrideStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

class MemoryOverrideStore implements OverrideStore {
  readonly #values = new Map<string, unknown>();
  get<T>(key: string) {
    return this.#values.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.#values.set(key, value);
  }
  delete(key: string) {
    this.#values.delete(key);
  }
}

export interface DashboardDeps {
  configStore: ConfigStore;
  cache: PollingCache;
  tokens: TokenStore;
  hub: StreamHub;
  env: Env;
  /** Keeps a manual override across restarts. Defaults to memory. */
  state?: OverrideStore;
  now?: () => Date;
  /** Defaults to every real provider; tests pass their own. */
  factories?: SourceFactory[];
  log?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

/**
 * Ties the parts together: which sources are polling, which profile is showing,
 * and who gets told when either changes.
 *
 * The profile is resolved server-side on a timer rather than in the browser, so
 * every client agrees on it and the switch still happens while the iPad is
 * asleep - it wakes up already showing the night dashboard.
 */
export class Dashboard {
  readonly #deps: DashboardDeps;
  readonly #now: () => Date;
  readonly #factories: SourceFactory[];
  readonly #state: OverrideStore;
  #override: ProfileOverride | null;
  #activeProfile: string;
  #profileTimer: NodeJS.Timeout | null = null;
  #registered = new Set<string>();

  constructor(deps: DashboardDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => new Date());
    this.#factories = deps.factories ?? sourceFactories;
    this.#state = deps.state ?? new MemoryOverrideStore();
    this.#override = this.#state.get<ProfileOverride>(OVERRIDE_KEY) ?? null;
    this.#dropStaleOverride(deps.configStore.current);
    this.#activeProfile = this.#resolveProfile(deps.configStore.current);
    this.#syncSources(deps.configStore.current);
  }

  get env(): Env {
    return this.#deps.env;
  }

  get config(): DashboardConfig {
    return this.#deps.configStore.current;
  }

  get activeProfile(): string {
    return this.#activeProfile;
  }

  /** The manual switch in force, or null when the schedule is in charge. */
  get override(): ProfileOverride | null {
    return this.#override;
  }

  /**
   * Show `profile` now, until the next scheduled switch. It then clears
   * itself: forcing night at 8pm does not leave the wall dark the next day.
   */
  setOverride(profile: string): ProfileOverride {
    const config = this.#deps.configStore.current;
    if (!config.profiles[profile]) throw new Error(`no profile called "${profile}" in config.yaml`);

    const until = nextBoundary(config.profiles, this.#now(), config.location.timezone);
    this.#override = { profile, until: until.toISOString() };
    this.#state.set(OVERRIDE_KEY, this.#override);
    this.checkProfile(true);
    return this.#override;
  }

  /** Hand control back to the schedule straight away. */
  clearOverride(): void {
    this.#override = null;
    this.#state.delete(OVERRIDE_KEY);
    this.checkProfile(true);
  }

  get cache(): PollingCache {
    return this.#deps.cache;
  }

  start(): void {
    this.#deps.cache.start();
    void this.#deps.cache.refreshAll();
    this.#profileTimer = setInterval(() => this.checkProfile(), PROFILE_TICK_MS);
    this.#profileTimer.unref?.();
  }

  stop(): void {
    this.#deps.cache.stop();
    if (this.#profileTimer) clearInterval(this.#profileTimer);
    this.#profileTimer = null;
  }

  /** Called after config.yaml changes, from the settings UI or from disk. */
  onConfigChanged(): void {
    const config = this.#deps.configStore.current;
    this.#syncSources(config);
    this.#deps.hub.broadcast({ type: "config-changed" });
    this.checkProfile();
    void this.#deps.cache.refreshAll();
  }

  #resolveProfile(config: DashboardConfig): string {
    if (this.#override) return this.#override.profile;
    return resolveActiveProfile(config.profiles, this.#now(), config.location.timezone);
  }

  /** Clear an override that has run its course or whose profile is gone. */
  #dropStaleOverride(config: DashboardConfig): boolean {
    if (!this.#override) return false;
    const expired = this.#now().getTime() >= Date.parse(this.#override.until);
    if (!expired && config.profiles[this.#override.profile]) return false;
    this.#override = null;
    this.#state.delete(OVERRIDE_KEY);
    return true;
  }

  /**
   * Re-evaluate which profile should show, telling every screen if it - or the
   * override behind it - has changed. Runs on a timer and after config edits.
   */
  checkProfile(force = false): string {
    const config = this.#deps.configStore.current;
    const overrideEnded = this.#dropStaleOverride(config);
    const next = this.#resolveProfile(config);
    if (next === this.#activeProfile && !force && !overrideEnded) return next;

    if (next !== this.#activeProfile) this.#deps.log?.info(`profile switched to ${next}`);
    this.#activeProfile = next;
    this.#deps.hub.broadcast({ type: "profile-changed", profile: next, override: this.#override });
    return next;
  }

  /**
   * Build a cache source for every provider the config can use, rebuilding the
   * lot whenever config.yaml changes - a factory reads settings such as the
   * location or a bulb's address once, when it creates its source, so a source
   * left over from the old config would keep using the old values.
   *
   * A provider that is unconfigured contributes nothing, so its widget reports
   * "not set up" rather than failing a request every refresh interval.
   */
  #syncSources(config: DashboardConfig): void {
    const ctx = { config, tokens: this.#deps.tokens, env: this.#deps.env };
    for (const factory of this.#factories) {
      let definition;
      try {
        definition = factory.create(ctx);
      } catch (cause) {
        // Leave whatever was running in place rather than dropping the widget.
        this.#deps.log?.warn(`provider ${factory.key} failed to initialise: ${String(cause)}`);
        continue;
      }
      if (definition) {
        this.#deps.cache.register(definition); // swaps in place if it already exists
        this.#registered.add(factory.key);
      } else if (this.#registered.has(factory.key)) {
        this.#deps.cache.unregister(factory.key); // configured before, not any more
        this.#registered.delete(factory.key);
      }
    }
  }

  /** Source keys that are live, for /api/health and the client's "not set up" state. */
  availableSources(): string[] {
    return [...this.#registered];
  }
}
