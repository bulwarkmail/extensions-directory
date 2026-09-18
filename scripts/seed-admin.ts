/**
 * Seed the first admin user into the directoryAdmins table.
 *
 * Usage:
 *   npx tsx scripts/seed-admin.ts <github-login>
 *
 * Example:
 *   npx tsx scripts/seed-admin.ts your-github-username
 *
 * The script fetches the GitHub user's info and inserts them
 * as a super_admin in the directoryAdmins table.
 *
 * Requires DATABASE_PATH to be set (or a .env file).
 */

import "dotenv/config";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { directoryAdmins } from "../lib/db/schema";
import path from "path";
import fs from "fs";

const login = process.argv[2];
if (!login) {
  console.error("Usage: npx tsx scripts/seed-admin.ts <github-login>");
  process.exit(1);
}

async function main() {
  // Fetch GitHub user info
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`);
  if (!res.ok) {
    console.error(`GitHub API error: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const user = await res.json();

  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "extensions.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);

  // Check if already exists
  const existing = await db
    .select()
    .from(directoryAdmins)
    .where(eq(directoryAdmins.githubId, user.id))
    .limit(1);

  if (existing.length > 0) {
    console.log(`Admin already exists: @${existing[0].githubLogin} (${existing[0].role})`);
    sqlite.close();
    return;
  }

  const result = await db
    .insert(directoryAdmins)
    .values({
      githubId: user.id,
      githubLogin: user.login,
      displayName: user.name || user.login,
      role: "super_admin",
    })
    .returning();

  console.log(`✓ Admin created: @${result[0].githubLogin} (${result[0].role})`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
