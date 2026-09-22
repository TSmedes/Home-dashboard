import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { Dashboard } from "../dashboard.js";
import type { TokenStore } from "../db/index.js";
import type { Env } from "../env.js";
import { PENDING_KEY, SpotifyClient, TOKEN_KEY, type SpotifyAction } from "../providers/spotify/client.js";
import {
  codeFromPaste,
  exchangeCode,
  PasteError,
  PENDING_TTL_MS,
  REDIRECT_URI,
  startSignIn,
  SpotifyGrantError,
  type PendingSignIn,
} from "../providers/spotify/oauth.js";

const CallbackSchema = z.object({ pasted: z.string().trim().min(1, "paste the address from your browser") });
const ACTIONS = new Set<SpotifyAction>(["play", "pause", "next", "previous"]);

const NOT_SET_UP = "Spotify is not set up: add SPOTIFY_CLIENT_ID to .env (npm run setup walks through it)";

/**
 * Connecting Spotify from the settings screen, and the playback controls.
 * A change to the sign-in rebuilds the sources, which is what makes the
 * widget swap between its setup prompt and the player.
 */
export const spotifyRoutes =
  (dashboard: Dashboard, tokens: TokenStore, env: Env): FastifyPluginAsync =>
  async (app: FastifyInstance) => {
    app.get("/api/spotify", async () => ({
      configured: Boolean(env.SPOTIFY_CLIENT_ID),
      connected: tokens.has(TOKEN_KEY),
      redirectUri: REDIRECT_URI,
    }));

    app.post("/api/spotify/connect", async (_request, reply) => {
      if (!env.SPOTIFY_CLIENT_ID) return reply.status(404).send({ error: NOT_SET_UP });
      const { url, pending } = startSignIn(env.SPOTIFY_CLIENT_ID);
      tokens.set(PENDING_KEY, pending);
      return { url, redirectUri: REDIRECT_URI };
    });

    app.post("/api/spotify/callback", async (request, reply) => {
      if (!env.SPOTIFY_CLIENT_ID) return reply.status(404).send({ error: NOT_SET_UP });
      const body = CallbackSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: body.error.issues[0]?.message ?? "invalid request" });

      const pending = tokens.get<PendingSignIn>(PENDING_KEY);
      if (!pending || Date.now() - pending.startedAt > PENDING_TTL_MS) {
        return reply.status(400).send({ error: "That sign-in has expired. Start again with Connect Spotify." });
      }

      try {
        const code = codeFromPaste(body.data.pasted, pending);
        tokens.set(TOKEN_KEY, await exchangeCode(env.SPOTIFY_CLIENT_ID, code, pending));
      } catch (cause) {
        // A pasting mistake or a refused code is the request's fault; anything
        // else is Spotify being unreachable.
        const status = cause instanceof SpotifyGrantError || cause instanceof PasteError ? 400 : 502;
        return reply.status(status).send({ error: cause instanceof Error ? cause.message : String(cause) });
      }
      tokens.clear(PENDING_KEY);
      dashboard.onConfigChanged();
      return { connected: true };
    });

    app.delete("/api/spotify", async () => {
      tokens.clear(TOKEN_KEY);
      tokens.clear(PENDING_KEY);
      dashboard.onConfigChanged();
      return { connected: false };
    });

    app.post<{ Params: { action: string } }>("/api/spotify/:action", async (request, reply) => {
      const action = request.params.action as SpotifyAction;
      if (!ACTIONS.has(action)) return reply.status(404).send({ error: `no Spotify control called "${action}"` });
      if (!env.SPOTIFY_CLIENT_ID || !tokens.has(TOKEN_KEY)) return reply.status(404).send({ error: NOT_SET_UP });

      try {
        await new SpotifyClient({ clientId: env.SPOTIFY_CLIENT_ID, vault: tokens }).control(action);
      } catch (cause) {
        return reply.status(502).send({ error: cause instanceof Error ? cause.message : String(cause) });
      }
      // Spotify takes a moment to report the new track; reading at once
      // would show the old one for a whole poll interval.
      await sleep(400);
      return await dashboard.cache.refresh("spotify");
    });
  };
