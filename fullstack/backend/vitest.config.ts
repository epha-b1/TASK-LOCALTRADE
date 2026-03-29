import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    sequence: { concurrent: false },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
