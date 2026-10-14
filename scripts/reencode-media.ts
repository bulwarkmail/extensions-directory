// Converts images stored before re-encoding existed (lib/reencode-media.ts).
// Bundled to deploy/dist/reencode-media.cjs by `npm run build:scripts`;
// deploy/migrate.cjs calls run() after the migrations. By hand:
//
//   DATABASE_PATH=... UPLOADS_DIR=... node deploy/dist/reencode-media.cjs [--dry-run]
import Database from "better-sqlite3";
import { reencodeStoredMedia } from "../lib/reencode-media";

export async function run(sqlite: Database.Database, uploadsDir: string, dryRun = false): Promise<void> {
  const report = await reencodeStoredMedia(sqlite, uploadsDir, { dryRun });
  const verb = dryRun ? "would convert" : "converted";
  for (const c of report.converted) console.log(`media: ${verb} ${c.table} ${c.id}: ${c.from} -> ${c.to}`);
  for (const d of report.dropped) console.warn(`media: ${dryRun ? "would drop" : "dropped"} ${d.table} ${d.id}: ${d.from} (${d.reason})`);
  console.log(`media: ${report.converted.length} ${verb}, ${report.dropped.length} unusable`);
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
