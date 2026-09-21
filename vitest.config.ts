import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const shared = fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url));

export default defineConfig({
  // Resolve the workspace package to source so tests never depend on a build step.
  resolve: { alias: { "@home-dash/shared": shared } },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
    environment: "node",
  },
});
