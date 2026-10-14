// Checks a migrated database against its files and its own counts. Reports
// problems; fixes nothing. Run by deploy/migrate.cjs after every migration.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

export interface VerifyReport {
  counts: Record<string, number>;
  problems: string[];
}

const TABLES = ["authors", "extensions", "extension_versions", "submissions", "screenshots", "theme_previews", "download_stats", "extension_members", "download_daily"];

export function verifyData(sqlite: Database.Database, uploadsDir: string): VerifyReport {
  const problems: string[] = [];
  const counts: Record<string, number> = {};
  const has = (t: string) => !!sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(t);
  for (const t of TABLES) if (has(t)) counts[t] = (sqlite.prepare(`select count(*) n from "${t}"`).get() as { n: number }).n;

  const file = (rel: string) => path.join(uploadsDir, rel);
  for (const v of sqlite.prepare("select e.slug, v.version, v.bundle_path, v.bundle_sha256 from extension_versions v join extensions e on e.id = v.extension_id").all() as { slug: string; version: string; bundle_path: string; bundle_sha256: string }[]) {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(file(v.bundle_path));
    } catch {
      problems.push(`${v.slug} ${v.version}: bundle file missing (${v.bundle_path})`);
      continue;
    }
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    if (sha !== v.bundle_sha256) problems.push(`${v.slug} ${v.version}: bundle hash ${sha} does not match ${v.bundle_sha256}`);
  }

  const media = [
    ...(sqlite.prepare("select slug, icon_path p from extensions where icon_path is not null").all() as { slug: string; p: string }[]),
    ...(sqlite.prepare("select slug, banner_path p from extensions where banner_path is not null").all() as { slug: string; p: string }[]),
    ...(sqlite.prepare("select e.slug, s.path p from screenshots s join extensions e on e.id = s.extension_id").all() as { slug: string; p: string }[]),
  ];
  for (const m of media) if (!fs.existsSync(file(m.p))) problems.push(`${m.slug}: image missing (${m.p})`);

  if (has("extension_members")) {
    const orphans = sqlite.prepare("select slug from extensions e where not exists (select 1 from extension_members m where m.extension_id = e.id and m.role = 'owner')").all() as { slug: string }[];
    for (const o of orphans) problems.push(`${o.slug}: no owner in extension_members`);
  }
  const versionCols = (sqlite.prepare("pragma table_info(extension_versions)").all() as { name: string }[]).map((c) => c.name);
  if (versionCols.includes("download_count")) {
    const counted = (sqlite.prepare("select coalesce(sum(download_count), 0) n from extension_versions").get() as { n: number }).n;
    const raw = (sqlite.prepare("select count(*) n from download_stats d where exists (select 1 from extension_versions v where v.id = d.version_id)").get() as { n: number }).n;
    if (counted < raw) problems.push(`download_count adds up to ${counted}, but download_stats has ${raw} rows`);
  }
  return { counts, problems };
}
