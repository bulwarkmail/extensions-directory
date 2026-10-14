import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", ".next/**"],
    // Every test file gets its own process, database and uploads folder
    // (tests/setup.ts), so files can't see each other's rows.
    pool: "forks",
    setupFiles: ["./tests/setup.ts"],
  },
});
