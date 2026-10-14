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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extdir-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
process.env.NEXT_PUBLIC_SITE_URL = "https://extensions.test";
// Analytics must never leave the test process.
process.env.UMAMI_WEBSITE_ID = "";
process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = "";

const sqlite = new Database(process.env.DATABASE_PATH);
migrate(drizzle(sqlite), {
  migrationsFolder: path.join(import.meta.dirname, "..", "drizzle", "migrations"),
});
sqlite.close();
