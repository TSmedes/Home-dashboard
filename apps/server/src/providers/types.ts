import type { DashboardConfig } from "@home-dash/shared";
import type { SourceDefinition } from "../cache/PollingCache.js";
import type { TokenStore } from "../db/index.js";
import type { Env } from "../env.js";

export interface ProviderContext {
  config: DashboardConfig;
  tokens: TokenStore;
  env: Env;
}

/**
 * A data source the dashboard can poll.
 *
 * `create` returns null when the provider is not configured or not yet
 * authorised. That is deliberately different from an error: the widget then
 * says "not set up" instead of retrying a doomed request every 15 minutes.
 */
export interface SourceFactory {
  key: string;
  create(ctx: ProviderContext): SourceDefinition<unknown> | null;
}

/** Raised when a provider is reachable but rejected us; surfaced in /api/health. */
export class ProviderAuthError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderAuthError";
  }
}
