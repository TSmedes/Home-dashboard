import { createHash, randomBytes } from "node:crypto";

/**
 * Spotify sign-in, Authorization Code with PKCE: no client secret exists
 * anywhere, only the public client id.
 *
 * Spotify accepts plain http only for a loopback IP, and the wall server is
 * not the machine with the browser, so the redirect goes to an address that
 * nothing listens on. The browser shows "can't connect", and the URL it is
 * stuck on - which carries the code - gets pasted back into settings.
 */

export const REDIRECT_URI = "http://127.0.0.1:8888/callback";
export const SCOPES = ["user-read-currently-playing", "user-read-playback-state", "user-modify-playback-state"];

const ACCOUNTS = "https://accounts.spotify.com";

/** What is kept in the token store under `spotify`. */
export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** A sign-in that has been started but not finished. */
export interface PendingSignIn {
  verifier: string;
  state: string;
  startedAt: number;
}

/** Pending sign-ins older than this are refused; the URL would be stale anyway. */
export const PENDING_TTL_MS = 30 * 60_000;

const base64url = (bytes: Buffer) => bytes.toString("base64url");

export function startSignIn(clientId: string, now = Date.now()): { url: string; pending: PendingSignIn } {
  const verifier = base64url(randomBytes(48));
  const state = base64url(randomBytes(16));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const url = new URL(`${ACCOUNTS}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  return { url: url.toString(), pending: { verifier, state, startedAt: now } };
}

/** What was pasted is not a usable Spotify redirect. */
export class PasteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasteError";
  }
}

/**
 * The code out of whatever was pasted: the whole address-bar URL, or the
 * query string on its own. Refuses a URL from a different sign-in attempt.
 */
export function codeFromPaste(pasted: string, pending: PendingSignIn): string {
  const text = pasted.trim();
  const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : text;
  const params = new URLSearchParams(query);

  const error = params.get("error");
  if (error === "access_denied") throw new PasteError("Spotify sign-in was cancelled.");
  if (error) throw new PasteError(`Spotify refused the sign-in: ${error}`);

  const code = params.get("code");
  if (!code) throw new PasteError("That doesn't look like the address Spotify sent you to. Copy the whole address bar.");
  if (params.get("state") !== pending.state) {
    throw new PasteError("That address is from a different sign-in. Start again with Connect Spotify.");
  }
  return code;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** Spotify's token endpoint said the grant is no good: sign in again. */
export class SpotifyGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpotifyGrantError";
  }
}

async function tokenRequest(body: URLSearchParams, fetcher: typeof fetch, now: number, previousRefresh?: string) {
  const response = await fetcher(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 400 || response.status === 401) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string; error_description?: string };
    throw new SpotifyGrantError(detail.error_description ?? detail.error ?? "Spotify refused the sign-in");
  }
  if (!response.ok) throw new Error(`Spotify accounts returned ${response.status}`);
  const token = (await response.json()) as TokenResponse;
  const refreshToken = token.refresh_token ?? previousRefresh;
  if (!refreshToken) throw new Error("Spotify did not return a refresh token");
  return {
    accessToken: token.access_token,
    refreshToken,
    // A minute early, so a request never goes out on a token about to lapse.
    expiresAt: now + (token.expires_in - 60) * 1000,
  } satisfies SpotifyTokens;
}

export function exchangeCode(
  clientId: string,
  code: string,
  pending: PendingSignIn,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<SpotifyTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: pending.verifier,
    }),
    fetcher,
    now,
  );
}

/** Spotify may rotate the refresh token; when it does not, the old one stands. */
export function refreshTokens(
  clientId: string,
  tokens: SpotifyTokens,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<SpotifyTokens> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: clientId }),
    fetcher,
    now,
    tokens.refreshToken,
  );
}
