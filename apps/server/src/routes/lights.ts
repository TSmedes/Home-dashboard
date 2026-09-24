import { z } from "zod";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { Dashboard } from "../dashboard.js";
import { createLightsAdapter } from "../providers/lights/index.js";

const CommandSchema = z
  .object({
    on: z.boolean().optional(),
    brightness: z.number().min(0).max(100).optional(),
    colourTemp: z.number().min(0).max(10_000).optional(),
    hue: z.number().min(0).max(360).optional(),
    saturation: z.number().min(0).max(100).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "no change requested" });

export const lightRoutes =
  (dashboard: Dashboard): FastifyPluginAsync =>
  async (app: FastifyInstance) => {
    app.post<{ Params: { id: string } }>("/api/lights/:id", async (request, reply) => {
      const adapter = createLightsAdapter(dashboard.config, dashboard.env);
      if (!adapter) return reply.status(404).send({ error: "no lights configured" });

      const command = CommandSchema.safeParse(request.body);
      if (!command.success) {
        return reply.status(400).send({ error: command.error.issues[0]?.message ?? "invalid command" });
      }

      const { id } = request.params;
      // Checked here so an unknown id reads as a bad request rather than
      // surfacing from the adapter as an upstream failure.
      if (!dashboard.config.lights.some((light) => light.id === id)) {
        return reply.status(404).send({ error: `no light called "${id}" in config.yaml` });
      }

      const { on, brightness, colourTemp, hue, saturation } = command.data;

      try {
        // Order matters: turning a bulb off last means a combined
        // "dim and switch off" request does not flash at the new brightness.
        if (brightness !== undefined) await adapter.setBrightness(id, brightness);
        if (colourTemp !== undefined) await adapter.setColourTemp(id, colourTemp);
        if (hue !== undefined && saturation !== undefined) await adapter.setColour(id, hue, saturation);
        if (on !== undefined) await adapter.setPower(id, on);
      } catch (cause) {
        return reply.status(502).send({ error: cause instanceof Error ? cause.message : String(cause) });
      }

      // Re-read so the wall reflects reality rather than what we hoped we set.
      return await dashboard.cache.refresh("lights");
    });
  };
