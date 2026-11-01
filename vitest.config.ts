import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@villages/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@villages/world/asset-store": path.resolve(__dirname, "packages/world/src/asset-store.ts"),
      "@villages/world": path.resolve(__dirname, "packages/world/src/index.ts"),
    },
  },
});
