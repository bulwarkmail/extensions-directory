// Backs up the directory database, then applies the SQL migrations in
// drizzle/migrations. Runs from an unpacked release (see
// deploy/extdir-deploy.sh and .github/workflows/deploy.yml), where
// drizzle-kit is not installed, so it uses the migrator that ships with
// drizzle-orm. Already-applied migrations are skipped. Then it runs the
// data steps bundled into deploy/dist (npm run build:scripts).
//
//   DATABASE_PATH=/path/extensions.db node deploy/migrate.cjs [--backup /path/backup.db]
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { drizzle } = require("drizzle-orm/better-sqlite3");
const { migrate } = require("drizzle-orm/better-sqlite3/migrator");

async function main() {
  const dbPath = process.env.DATABASE_PATH;
  if (!dbPath) throw new Error("DATABASE_PATH is not set");
  const i = process.argv.indexOf("--backup");
  const backupPath = i > -1 ? process.argv[i + 1] : null;

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  if (backupPath) {
    // Online backup: consistent even while the old release is serving.
    await sqlite.backup(backupPath);
    console.log(`backup: ${backupPath}`);
  }

  const count = () =>
    sqlite.prepare("select count(*) as n from sqlite_master where name = '__drizzle_migrations'").get().n
      ? sqlite.prepare("select count(*) as n from __drizzle_migrations").get().n
      : 0;
  const before = count();
  migrate(drizzle(sqlite), { migrationsFolder: path.join(__dirname, "..", "drizzle", "migrations") });
  console.log(`migrations: ${before} applied before, ${count()} after`);

  // Re-encode images stored before lib/images.ts (scripts/reencode-media.ts).
  // Converted rows are skipped, so this is quick once done. A failure here
  // doesn't stop the deploy: unconverted images are simply not served.
  const reencode = path.join(__dirname, "dist", "reencode-media.cjs");
  if (fs.existsSync(reencode)) {
    try {
      await require(reencode).run(sqlite, uploadsDir());
    } catch (err) {
      console.error("media: conversion failed, images stay unconverted:", err);
    }
  }
  sqlite.close();
}

// UPLOADS_DIR as the app sees it: the environment, else the release's .env
// (a link to the shared one), else the app's default.
function uploadsDir() {
  let dir = process.env.UPLOADS_DIR;
  if (!dir) {
    try {
      const m = fs.readFileSync(".env", "utf8").match(/^\s*UPLOADS_DIR\s*=\s*["']?(.*?)["']?\s*$/m);
      if (m) dir = m[1];
    } catch {
      // no .env
    }
  }
  return path.resolve(dir || path.join("data", "uploads"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
