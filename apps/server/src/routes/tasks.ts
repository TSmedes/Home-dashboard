import { z } from "zod";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { Dashboard } from "../dashboard.js";
import type { Env } from "../env.js";
import { createTickTick } from "../providers/tasks/index.js";

const CreateSchema = z.object({ title: z.string().trim().min(1, "a task needs a title").max(500) });
const CompleteSchema = z.object({ projectId: z.string().min(1) });

export const taskRoutes =
  (dashboard: Dashboard, env: Env): FastifyPluginAsync =>
  async (app: FastifyInstance) => {
    const client = () => createTickTick(dashboard.config, env);

    /** Quick-add. Always lands in the configured list (🏡To-Do by default). */
    app.post("/api/tasks", async (request, reply) => {
      const tasks = client();
      if (!tasks) return reply.status(404).send({ error: "TickTick is not set up; run npm run setup" });
      const body = CreateSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: body.error.issues[0]?.message ?? "invalid task" });

      try {
        await tasks.create(body.data.title);
      } catch (cause) {
        return reply.status(502).send({ error: cause instanceof Error ? cause.message : String(cause) });
      }
      return await dashboard.cache.refresh("tasks");
    });

    app.post<{ Params: { id: string } }>("/api/tasks/:id/complete", async (request, reply) => {
      const tasks = client();
      if (!tasks) return reply.status(404).send({ error: "TickTick is not set up; run npm run setup" });
      const body = CompleteSchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: "projectId is required" });

      try {
        await tasks.complete(body.data.projectId, request.params.id);
      } catch (cause) {
        return reply.status(502).send({ error: cause instanceof Error ? cause.message : String(cause) });
      }
      // Re-read so the wall reflects TickTick rather than what we hoped happened.
      return await dashboard.cache.refresh("tasks");
    });
  };
