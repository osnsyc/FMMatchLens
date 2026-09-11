import { defineConfig } from "vitest/config"

export default defineConfig({
  define: {
    __API_PORT__: 0,
  },
  test: {
    include: ["tests/replay/replay.bench.ts"],
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": new URL("../src", import.meta.url).pathname,
    },
  },
})
