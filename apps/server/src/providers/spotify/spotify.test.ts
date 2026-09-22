import { describe, expect, it, vi } from "vitest";
import { mapPlayback, SpotifyClient, TOKEN_KEY, type PlaybackState } from "./client.js";
import { codeFromPaste, exchangeCode, REDIRECT_URI, startSignIn, type SpotifyTokens } from "./oauth.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

class Vault {
  values = new Map<string, unknown>();
  get<T>(key: string) {
    return this.values.get(key) as T | undefined;
  }
  set(key: string, value: unknown) {
    this.values.set(key, value);
  }
}

/** A recorded GET /me/player while a track plays, trimmed to what is read. */
const playing: PlaybackState = {
  is_playing: true,
  progress_ms: 61_000,
  device: { name: "Kitchen speaker" },
  item: {
    name: "Time (You and I)",
    duration_ms: 257_000,
    artists: [{ name: "Khruangbin" }],
    album: {
      name: "Mordechai",
      images: [
        { url: "https://i.scdn.co/image/300", width: 300 },
        { url: "https://i.scdn.co/image/640", width: 640 },
        { url: "https://i.scdn.co/image/64", width: 64 },
      ],
    },
  },
};

describe("sign-in", () => {
  it("asks for PKCE with the loopback redirect Spotify accepts", () => {
    const { url, pending } = startSignIn("client-1");
    const params = new URL(url).searchParams;
    expect(params.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(REDIRECT_URI).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).not.toBe(pending.verifier);
    expect(params.get("state")).toBe(pending.state);
    expect(params.get("scope")).toContain("user-read-playback-state");
  });

  it("finds the code in a pasted address bar, checking it belongs to this sign-in", () => {
    const pending = { verifier: "v", state: "abc", startedAt: 0 };
    expect(codeFromPaste(" http://127.0.0.1:8888/callback?code=XYZ&state=abc ", pending)).toBe("XYZ");
    expect(codeFromPaste("code=XYZ&state=abc", pending)).toBe("XYZ");
    expect(() => codeFromPaste("http://127.0.0.1:8888/callback?code=XYZ&state=other", pending)).toThrow(/different sign-in/);
    expect(() => codeFromPaste("http://127.0.0.1:8888/callback?error=access_denied&state=abc", pending)).toThrow(/cancelled/);
    expect(() => codeFromPaste("hello", pending)).toThrow(/whole address bar/);
  });

  it("swaps the code for tokens using the verifier, with no client secret", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("code_verifier")).toBe("verifier-1");
      expect(body.has("client_secret")).toBe(false);
      return json(200, { access_token: "A", refresh_token: "R", expires_in: 3600 });
    });
    const tokens = await exchangeCode("client-1", "CODE", { verifier: "verifier-1", state: "s", startedAt: 0 }, fetcher as typeof fetch, 1_000);
    expect(tokens).toEqual({ accessToken: "A", refreshToken: "R", expiresAt: 1_000 + 3_540_000 });
  });
});

describe("mapPlayback", () => {
  it("reads the track, the largest artwork and the progress", () => {
    expect(mapPlayback(playing, "premium")).toEqual({
      problem: null,
      product: "premium",
      playing: true,
      track: {
        title: "Time (You and I)",
        artist: "Khruangbin",
        album: "Mordechai",
        artwork: "https://i.scdn.co/image/640",
        durationMs: 257_000,
      },
      progressMs: 61_000,
      device: "Kitchen speaker",
    });
  });

  it("names the show for a podcast episode", () => {
    const episode: PlaybackState = {
      is_playing: false,
      progress_ms: 5,
      item: { name: "Episode 12", duration_ms: 100, show: { name: "The Show", images: [{ url: "s.jpg" }] } },
    };
    const snapshot = mapPlayback(episode, "free");
    expect(snapshot.track).toMatchObject({ artist: "The Show", artwork: "s.jpg" });
    expect(snapshot.playing).toBe(false);
  });

  it("shows nothing playing when no device is active", () => {
    expect(mapPlayback(null, "free")).toMatchObject({ playing: false, track: null, progressMs: 0 });
  });
});

describe("SpotifyClient", () => {
  const fresh: SpotifyTokens = { accessToken: "A", refreshToken: "R", expiresAt: 10_000 };

  it("refreshes an expired token and stores the rotated refresh token", async () => {
    const vault = new Vault();
    vault.set(TOKEN_KEY, { ...fresh, expiresAt: 0 });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/token")) return json(200, { access_token: "A2", refresh_token: "R2", expires_in: 3600 });
      if (String(url).endsWith("/me")) return json(200, { product: "premium" });
      return new Response(null, { status: 204 });
    });
    const client = new SpotifyClient({ clientId: "c", vault, fetch: fetcher as typeof fetch, now: () => 5_000 });
    const snapshot = await client.read();
    expect(snapshot).toMatchObject({ problem: null, product: "premium", track: null });
    expect(vault.get<SpotifyTokens>(TOKEN_KEY)).toMatchObject({ accessToken: "A2", refreshToken: "R2" });
  });

  it("reports premium-required instead of failing when the account is free", async () => {
    const vault = new Vault();
    vault.set(TOKEN_KEY, fresh);
    const fetcher = vi.fn(async () =>
      json(403, { error: { status: 403, message: "Active premium subscription required for the owner of the app." } }),
    );
    const client = new SpotifyClient({ clientId: "c", vault, fetch: fetcher as typeof fetch, now: () => 0 });
    expect((await client.read()).problem).toBe("premium-required");
  });

  it("reports reconnect when the refresh token has been revoked", async () => {
    const vault = new Vault();
    vault.set(TOKEN_KEY, { ...fresh, expiresAt: 0 });
    const fetcher = vi.fn(async () => json(400, { error: "invalid_grant", error_description: "Refresh token revoked" }));
    const client = new SpotifyClient({ clientId: "c", vault, fetch: fetcher as typeof fetch, now: () => 5_000 });
    expect((await client.read()).problem).toBe("reconnect");
  });

  it("explains a refused control on a free account", async () => {
    const vault = new Vault();
    vault.set(TOKEN_KEY, fresh);
    const fetcher = vi.fn(async () => json(403, { error: { status: 403, message: "Player command failed: Premium required", reason: "PREMIUM_REQUIRED" } }));
    const client = new SpotifyClient({ clientId: "c", vault, fetch: fetcher as typeof fetch, now: () => 0 });
    await expect(client.control("pause")).rejects.toThrow(/need Spotify Premium/);
  });

  it("sends each control to the right endpoint", async () => {
    const vault = new Vault();
    vault.set(TOKEN_KEY, fresh);
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new SpotifyClient({ clientId: "c", vault, fetch: fetcher as typeof fetch, now: () => 0 });
    await client.control("next");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.spotify.com/v1/me/player/next");
    expect(init.method).toBe("POST");
  });
});
