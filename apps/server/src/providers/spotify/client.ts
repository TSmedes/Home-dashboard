import type { SpotifySnapshot, SpotifyTrack } from "@home-dash/shared";
import { refreshTokens, SpotifyGrantError, type SpotifyTokens } from "./oauth.js";

/**
 * What is playing, and - on Premium - play, pause and skip.
 *
 * Two account problems are reported as data rather than as errors, because
 * retrying will not fix them and the widget should say what will:
 *  - Since February 2026 Spotify serves a developer app only while its owner
 *    has Premium. On a free account every call is refused with a 403.
 *  - A revoked or expired sign-in needs connecting again from settings.
 */

const API = "https://api.spotify.com/v1";

export const TOKEN_KEY = "spotify";
export const PENDING_KEY = "spotify:pending";

/** The slice of the token store this needs. */
export interface TokenVault {
  get<T>(provider: string): T | undefined;
  set(provider: string, payload: unknown): void;
}

export type SpotifyAction = "play" | "pause" | "next" | "previous";

const ACTIONS: Record<SpotifyAction, { method: "PUT" | "POST"; path: string }> = {
  play: { method: "PUT", path: "/me/player/play" },
  pause: { method: "PUT", path: "/me/player/pause" },
  next: { method: "POST", path: "/me/player/next" },
  previous: { method: "POST", path: "/me/player/previous" },
};

interface Image {
  url: string;
  width?: number | null;
}

/** The slice of GET /me/player that is read. Tracks and podcast episodes differ. */
export interface PlaybackState {
  is_playing: boolean;
  progress_ms: number | null;
  device?: { name?: string } | null;
  item?: {
    name: string;
    duration_ms: number;
    artists?: { name: string }[];
    album?: { name: string; images?: Image[] };
    show?: { name: string; images?: Image[] };
    images?: Image[];
  } | null;
}

class PremiumRequired extends Error {}

function largest(images: Image[] | undefined): string | null {
  if (!images?.length) return null;
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]!.url;
}

export function mapPlayback(state: PlaybackState | null, product: string | null): SpotifySnapshot {
  const item = state?.item;
  const track: SpotifyTrack | null = item
    ? {
        title: item.name,
        artist: item.artists?.length ? item.artists.map((a) => a.name).join(", ") : (item.show?.name ?? ""),
        album: item.album?.name ?? item.show?.name ?? "",
        artwork: largest(item.album?.images ?? item.images ?? item.show?.images),
        durationMs: item.duration_ms,
      }
    : null;

  return {
    problem: null,
    product,
    playing: Boolean(state?.is_playing && track),
    track,
    progressMs: state?.progress_ms ?? 0,
    device: state?.device?.name ?? null,
  };
}

const blocked = (problem: NonNullable<SpotifySnapshot["problem"]>): SpotifySnapshot => ({
  problem,
  product: null,
  playing: false,
  track: null,
  progressMs: 0,
  device: null,
});

export class SpotifyClient {
  readonly #clientId: string;
  readonly #vault: TokenVault;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #product: string | null = null;

  constructor(opts: { clientId: string; vault: TokenVault; fetch?: typeof fetch; now?: () => number }) {
    this.#clientId = opts.clientId;
    this.#vault = opts.vault;
    this.#fetch = opts.fetch ?? fetch;
    this.#now = opts.now ?? Date.now;
  }

  async read(): Promise<SpotifySnapshot> {
    try {
      // The account tier only changes on an upgrade, so it is read once.
      this.#product ??= (await this.#call<{ product?: string }>("GET", "/me"))?.product ?? null;
      const state = await this.#call<PlaybackState>("GET", "/me/player");
      return mapPlayback(state, this.#product);
    } catch (cause) {
      if (cause instanceof PremiumRequired) return blocked("premium-required");
      if (cause instanceof SpotifyGrantError) return blocked("reconnect");
      throw cause;
    }
  }

  async control(action: SpotifyAction): Promise<void> {
    const { method, path } = ACTIONS[action];
    try {
      await this.#call(method, path);
    } catch (cause) {
      if (cause instanceof PremiumRequired) throw new Error("Play, pause and skip need Spotify Premium.");
      if (cause instanceof SpotifyGrantError) throw new Error("Spotify needs connecting again, in settings.");
      throw cause;
    }
  }

  async #token(): Promise<string> {
    let tokens = this.#vault.get<SpotifyTokens>(TOKEN_KEY);
    if (!tokens) throw new SpotifyGrantError("not connected");
    if (this.#now() >= tokens.expiresAt) {
      tokens = await refreshTokens(this.#clientId, tokens, this.#fetch, this.#now());
      // Stored straight away: Spotify may have rotated the refresh token, and
      // the old one stops working once the new one is issued.
      this.#vault.set(TOKEN_KEY, tokens);
    }
    return tokens.accessToken;
  }

  /** Null for 204 No Content, which /me/player returns when nothing is active. */
  async #call<T>(method: string, path: string): Promise<T | null> {
    const response = await this.#fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.#token()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 204 || response.status === 202) return null;
    if (response.ok) {
      const text = await response.text();
      return text ? (JSON.parse(text) as T) : null;
    }

    const detail = (await response.json().catch(() => ({}))) as { error?: { message?: string; reason?: string } };
    const message = detail.error?.message ?? "";
    if (response.status === 401) throw new SpotifyGrantError(message || "Spotify rejected the sign-in");
    if (response.status === 403 && (/premium/i.test(message) || detail.error?.reason === "PREMIUM_REQUIRED")) {
      throw new PremiumRequired(message);
    }
    if (response.status === 404 && detail.error?.reason === "NO_ACTIVE_DEVICE") {
      throw new Error("Nothing is playing on any device right now.");
    }
    throw new Error(`Spotify returned ${response.status}${message ? `: ${message}` : ""}`);
  }
}
