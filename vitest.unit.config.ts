import { defineConfig } from "vitest/config";
import path from "node:path";

/** Pure unit tests: no globalSetup (no migrations), no test-DB env requirement. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 20000,
  },
});
