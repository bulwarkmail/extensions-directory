// Runs before each test file is imported: points the app at a fresh SQLite
// file and uploads folder, and applies the real migrations to it. lib/db/client
// reads DATABASE_PATH when it is first imported, so this has to happen here
// and not inside a test.
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extdir-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
process.env.STAGING_DIR = path.join(dir, "staging");
process.env.SANDBOX_BUILD_CACHE = path.join(dir, "build-cache");
process.env.SANDBOX_RUNNER = "off";
process.env.NEXT_PUBLIC_SITE_URL = "https://extensions.test";
// Analytics must never leave the test process.
process.env.UMAMI_WEBSITE_ID = "";
process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = "";

const sqlite = new Database(process.env.DATABASE_PATH);
migrate(drizzle(sqlite), {
  migrationsFolder: path.join(import.meta.dirname, "..", "drizzle", "migrations"),
});
sqlite.close();

// Route handlers read cookies through next/headers, which only works inside
// a Next request. Tests get one shared in-memory jar instead
// (tests/helpers/session.ts signs in by writing to it).
const jar = new Map<string, string>();
(globalThis as { __cookieJar?: Map<string, string> }).__cookieJar = jar;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.has(name),
    set: (name: string | { name: string; value: string }, value?: string) => {
      if (typeof name === "object") jar.set(name.name, name.value);
      else jar.set(name, value ?? "");
    },
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
