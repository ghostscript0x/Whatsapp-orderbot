import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/env-setup.ts"],
    // Integration tests share one test database; run files serially.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
