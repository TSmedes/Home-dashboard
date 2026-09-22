import { z } from "zod";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { StreamEvent } from "@home-dash/shared";
import type { Dashboard } from "../dashboard.js";
import { searchPlaces } from "../providers/geocode/openMeteo.js";
import type { ConfigStore } from "../config/loader.js";
import type { StreamHub } from "../stream.js";

export interface ApiDeps {
  dashboard: Dashboard;
  configStore: ConfigStore;
  hub: StreamHub;
  onConfigWritten: () => void;
}

const PatchSchema = z.object({
  changes: z
    .array(
      z.object({
        path: z
          .array(z.union([z.string().min(1), z.number().int().min(0), z.object({ id: z.string().min(1) })]))
          .min(1),
        value: z.unknown(),
        op: z.literal("insert").optional(),
      }),
    )
    .min(1)
    // One save from edit mode is one request: re-laying out a page is easily
    // two dozen edits, and splitting them would mean a half-written config.
    .max(200),
});

export const apiRoutes =
  (deps: ApiDeps): FastifyPluginAsync =>
  async (app: FastifyInstance) => {
    const { dashboard, configStore, hub } = deps;

    /** Everything the client needs for a first paint. */
    app.get("/api/config", async () => ({
      config: configStore.current,
      activeProfile: dashboard.activeProfile,
      override: dashboard.override,
      availableSources: dashboard.availableSources(),
      serverTime: new Date().toISOString(),
    }));

    app.put("/api/config", async (request, reply) => {
      try {
        const saved = await configStore.replace(request.body);
        deps.onConfigWritten();
        return { config: saved, activeProfile: dashboard.activeProfile };
      } catch (cause) {
        // A rejected save leaves config.yaml untouched; say why, plainly.
        return reply.status(400).send({ error: String(cause instanceof Error ? cause.message : cause) });
      }
    });

    /** Location search for the settings screen. */
    app.get<{ Querystring: { q?: string } }>("/api/geocode", async (request, reply) => {
      try {
        return { places: await searchPlaces(request.query.q ?? "") };
      } catch (cause) {
        return reply.status(502).send({ error: String(cause instanceof Error ? cause.message : cause) });
      }
    });

    /** Switch profile by hand until the next scheduled switch. */
    app.post("/api/profile/override", async (request, reply) => {
      const body = z.object({ profile: z.string().min(1) }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: "expected { profile }" });
      try {
        const override = dashboard.setOverride(body.data.profile);
        return { activeProfile: dashboard.activeProfile, override };
      } catch (cause) {
        return reply.status(400).send({ error: String(cause instanceof Error ? cause.message : cause) });
      }
    });

    /** Back to the schedule. */
    app.delete("/api/profile/override", async () => {
      dashboard.clearOverride();
      return { activeProfile: dashboard.activeProfile, override: null };
    });

    /**
     * Targeted edits from the settings screen. Touches only the addressed
     * values in config.yaml; see ConfigStore.patch.
     */
    app.patch("/api/config", async (request, reply) => {
      const body = PatchSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: "expected { changes: [{ path, value }] }" });
      try {
        const saved = await configStore.patch(body.data.changes.map(({ path, value, op }) => ({ path, value, op })));
        deps.onConfigWritten();
        return { config: saved, activeProfile: dashboard.activeProfile };
      } catch (cause) {
        return reply.status(400).send({ error: String(cause instanceof Error ? cause.message : cause) });
      }
    });

    /**
     * The single update channel. Sends a hello plus a snapshot of every source
     * immediately, so a reconnecting iPad repaints without waiting for the next
     * poll of anything.
     */
    app.get("/api/stream", (request, reply) => {
      hub.add(reply);
      hub.send(reply, {
        type: "hello",
        profile: dashboard.activeProfile,
        override: dashboard.override,
        serverTime: new Date().toISOString(),
      });
      for (const key of dashboard.cache.keys()) {
        hub.send(reply, { type: "widget-data", key, envelope: dashboard.cache.get(key) });
      }
    });

    app.get<{ Params: { key: string } }>("/api/widgets/:key/data", async (request, reply) => {
      try {
        return dashboard.cache.get(request.params.key);
      } catch {
        return reply.status(404).send({ error: `no data source named "${request.params.key}"` });
      }
    });

    app.post<{ Params: { key: string } }>("/api/widgets/:key/refresh", async (request, reply) => {
      try {
        return await dashboard.cache.refresh(request.params.key);
      } catch {
        return reply.status(404).send({ error: `no data source named "${request.params.key}"` });
      }
    });

    /** Per-provider status, for working out which integration is unhappy. */
    app.get("/api/health", async () => ({
      ok: true,
      activeProfile: dashboard.activeProfile,
      streamClients: hub.size,
      uptimeSeconds: Math.round(process.uptime()),
      sources: dashboard.cache.keys().map((key) => {
        const env = dashboard.cache.get(key);
        return { key, stale: env.stale, fetchedAt: env.fetchedAt, error: env.error?.message ?? null };
      }),
    }));
  };

export type { StreamEvent };
