// Tests that start the built app (they need `next build` first), kept out of `npm test`.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/http/**/*.http.ts"],
    exclude: ["**/node_modules/**", ".next/**"],
    pool: "forks",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30_000,
  },
});
