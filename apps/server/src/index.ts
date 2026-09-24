import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import chokidar from "chokidar";
import "dotenv/config";
import Fastify from "fastify";
import { PollingCache } from "./cache/PollingCache.js";
import { ConfigStore } from "./config/loader.js";
import { Dashboard } from "./dashboard.js";
import { openDatabase, SqliteCacheStore, StateStore, TokenStore } from "./db/index.js";
import { loadEnv } from "./env.js";
import { apiRoutes } from "./routes/api.js";
import { lightRoutes } from "./routes/lights.js";
import { spotifyRoutes } from "./routes/spotify.js";
import { taskRoutes } from "./routes/tasks.js";
import { StreamHub } from "./stream.js";
import { entryFor } from "./webEntries.js";

const env = loadEnv();
const app = Fastify({ logger: { level: env.LOG_LEVEL } });

const configPath = resolve(env.CONFIG_PATH);
const configStore = await ConfigStore.open(configPath).catch((cause: unknown) => {
  app.log.error(String(cause instanceof Error ? cause.message : cause));
  app.log.error(`Copy config/config.example.yaml to ${configPath} and edit it, or run: npm run setup`);
  process.exit(1);
});

const db = openDatabase(join(resolve(env.DATA_DIR), "dashboard.db"));
const tokens = new TokenStore(db);
const hub = new StreamHub();
const cache = new PollingCache({ store: new SqliteCacheStore(db) });

const dashboard = new Dashboard({ configStore, cache, tokens, hub, env, state: new StateStore(db), log: app.log });

// Every completed refresh pushes straight out to connected clients.
cache.subscribe((envelope) => {
  hub.broadcast({ type: "widget-data", key: envelope.key, envelope });
});

await app.register(
  apiRoutes({ dashboard, configStore, hub, onConfigWritten: () => dashboard.onConfigChanged() }),
);
await app.register(lightRoutes(dashboard));
await app.register(taskRoutes(dashboard, env));
await app.register(spotifyRoutes(dashboard, tokens, env));

// Serve the built frontend: the chooser at "/", the wall at /kiosk/, the
// lights app at /lights/. Anything the files do not answer goes to the page
// that owns that path. register() is lazy - a try/catch around it would never
// fire - so the directory is checked up front instead.
const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(join(webRoot, "index.html"))) {
  // redirect: /lights -> /lights/, so the page's relative URLs resolve.
  await app.register(fastifyStatic, { root: webRoot, redirect: true });
  app.setNotFoundHandler((request, reply) => {
    const entry = entryFor(request.url);
    if (entry === "api") return reply.status(404).send({ error: "not found" });
    return reply.sendFile(entry);
  });
} else {
  app.log.warn(`no built frontend at ${webRoot} - run "npm run build". The API still works.`);
}

/**
 * Hot-reload config.yaml. A broken hand edit logs and is ignored: ConfigStore
 * keeps the last good config, so a typo over SSH never blanks the wall display.
 */
let reloadTimer: NodeJS.Timeout | null = null;
const watcher = chokidar.watch(configPath, { ignoreInitial: true });
watcher.on("all", () => {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    configStore
      .reload()
      .then(() => {
        app.log.info("config.yaml reloaded");
        dashboard.onConfigChanged();
      })
      .catch((cause: unknown) => {
        app.log.error(`config.yaml reload rejected, keeping previous config: ${String(cause)}`);
      });
  }, 150);
});

dashboard.start();

const port = env.PORT ?? configStore.current.server.port;
await app.listen({ port, host: env.HOST });
app.log.info(`home-dash listening on http://${env.HOST}:${port} (profile: ${dashboard.activeProfile})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info("shutting down");
    dashboard.stop();
    hub.close();
    void watcher.close();
    void app.close().then(() => process.exit(0));
  });
}
