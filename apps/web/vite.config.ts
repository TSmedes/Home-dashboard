import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** /kiosk and /lights are directories; send the bare name to the page, as the server does. */
const trailingSlash = (): Plugin => ({
  name: "home-dash-trailing-slash",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const [path, query] = (req.url ?? "").split("?");
      if (path === "/kiosk" || path === "/lights") {
        res.writeHead(301, { Location: `${path}/${query ? `?${query}` : ""}` }).end();
        return;
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), trailingSlash()],
  resolve: {
    // Use the workspace package's source so a change to a shared type is
    // picked up without a build step.
    alias: { "@home-dash/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true, // reachable from the iPad while developing
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true, ws: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "safari16",
    // Three pages, one server: "/" chooses, /kiosk/ is the wall, /lights/ the phone app.
    rollupOptions: {
      input: {
        chooser: entry("./index.html"),
        kiosk: entry("./kiosk/index.html"),
        lights: entry("./lights/index.html"),
      },
    },
  },
});
