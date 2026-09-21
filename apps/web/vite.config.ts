import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
  build: { outDir: "dist", emptyOutDir: true, target: "safari16" },
});
