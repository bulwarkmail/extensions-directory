// Data steps after the SQL migrations, bundled to deploy/dist/post-migrate.cjs
// by `npm run build:scripts` and called by deploy/migrate.cjs:
//   1. latest-version caches (SQLite can't order semver),
//   2. re-encode images stored before lib/images.ts,
//   3. check the data against the files (report only).
// Every step is idempotent. By hand:
//
//   DATABASE_PATH=... UPLOADS_DIR=... node deploy/dist/post-migrate.cjs [--dry-run]
import Database from "better-sqlite3";
import { refreshLatest } from "../lib/release-caches";
import { reencodeStoredMedia } from "../lib/reencode-media";
import { verifyData } from "../lib/verify-data";

export async function run(sqlite: Database.Database, uploadsDir: string, dryRun = false): Promise<{ problems: string[] }> {
  const hasColumn = (sqlite.prepare("pragma table_info(extensions)").all() as { name: string }[]).some((c) => c.name === "latest_stable_version_id");
  if (hasColumn && !dryRun) console.log(`caches: refreshed ${refreshLatest(sqlite)} extensions`);

  try {
    const report = await reencodeStoredMedia(sqlite, uploadsDir, { dryRun });
    const verb = dryRun ? "would convert" : "converted";
    for (const c of report.converted) console.log(`media: ${verb} ${c.table} ${c.id}: ${c.from} -> ${c.to}`);
    for (const d of report.dropped) console.warn(`media: ${dryRun ? "would drop" : "dropped"} ${d.table} ${d.id}: ${d.from} (${d.reason})`);
    console.log(`media: ${report.converted.length} ${verb}, ${report.dropped.length} unusable`);
  } catch (err) {
    // Unconverted images are simply not served; don't stop the deploy.
    console.error("media: conversion failed, images stay unconverted:", err);
  }

  const verify = verifyData(sqlite, uploadsDir);
  console.log(`verify: ${Object.entries(verify.counts).map(([t, n]) => `${t}=${n}`).join(" ")}`);
  for (const p of verify.problems) console.warn(`verify: ${p}`);
  console.log(`verify: ${verify.problems.length} problems`);
  return verify;
}

if (require.main === module) {
  const dbPath = process.env.DATABASE_PATH;
  const uploads = process.env.UPLOADS_DIR;
  if (!dbPath || !uploads) {
    console.error("DATABASE_PATH and UPLOADS_DIR must be set");
    process.exit(2);
  }
  const sqlite = new Database(dbPath);
  run(sqlite, uploads, process.argv.includes("--dry-run"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => sqlite.close());
}
