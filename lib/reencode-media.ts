// One-time conversion of images stored before lib/images.ts existed: every
// icon, banner, screenshot and theme preview whose path is not a media/
// path is re-encoded and its row pointed at the result. Old files stay on
// disk (nothing serves them any more). Safe to run again: converted rows
// are skipped. Run by deploy/migrate.cjs after the migrations.
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { encodeImage, ImageError, mediaPath, type ImageKind } from "./images";

const MEDIA = /^media\//;

export interface ReencodeReport {
  converted: { table: string; id: string; from: string; to: string }[];
  /** Rows whose image could not be converted; their path was cleared. */
  dropped: { table: string; id: string; from: string; reason: string }[];
}

interface Target {
  table: string;
  column: string;
  kind: ImageKind;
  /** Name inside media/<slug>/ for the row. */
  name: (row: { id: string; sort: number | null; variant: string | null }) => string;
  select: string;
  /** Rows without a usable image: clear the column, or delete the row. */
  onFail: "clear" | "delete";
}

const TARGETS: Target[] = [
  { table: "extensions", column: "icon_path", kind: "icon", name: () => "icon", onFail: "clear",
    select: "select e.id, e.slug, e.icon_path as path, null as sort, null as variant from extensions e where e.icon_path is not null" },
  { table: "extensions", column: "banner_path", kind: "banner", name: () => "banner", onFail: "clear",
    select: "select e.id, e.slug, e.banner_path as path, null as sort, null as variant from extensions e where e.banner_path is not null" },
  { table: "screenshots", column: "path", kind: "screenshot", name: (r) => `screenshot-${(r.sort ?? 0) + 1}`, onFail: "delete",
    select: "select s.id, e.slug, s.path, s.sort_order as sort, null as variant from screenshots s join extensions e on e.id = s.extension_id" },
  { table: "theme_previews", column: "preview_path", kind: "preview", name: (r) => `preview-${r.variant}`, onFail: "delete",
    select: "select p.id, e.slug, p.preview_path as path, null as sort, p.variant from theme_previews p join extensions e on e.id = p.extension_id" },
];

export async function reencodeStoredMedia(
  sqlite: Database.Database,
  uploadsDir: string,
  opts: { dryRun?: boolean } = {}
): Promise<ReencodeReport> {
  const report: ReencodeReport = { converted: [], dropped: [] };
  const root = path.resolve(uploadsDir);

  for (const t of TARGETS) {
    const rows = sqlite.prepare(t.select).all() as {
      id: string; slug: string; path: string; sort: number | null; variant: string | null;
    }[];
    for (const row of rows) {
      if (MEDIA.test(row.path)) continue;
      const fail = (reason: string) => {
        report.dropped.push({ table: t.table, id: row.id, from: row.path, reason });
        if (opts.dryRun) return;
        if (t.onFail === "clear") sqlite.prepare(`update ${t.table} set ${t.column} = null where id = ?`).run(row.id);
        else sqlite.prepare(`delete from ${t.table} where id = ?`).run(row.id);
      };

      const full = path.resolve(root, row.path);
      if (!full.startsWith(root + path.sep)) { fail("path leaves the uploads folder"); continue; }
      let input: Buffer;
      try {
        input = fs.readFileSync(full);
      } catch {
        fail("file missing");
        continue;
      }
      try {
        const image = await encodeImage(input, t.kind);
        const to = mediaPath(row.slug, t.name(row), image);
        report.converted.push({ table: t.table, id: row.id, from: row.path, to });
        if (opts.dryRun) continue;
        const out = path.join(root, to);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, image.data);
        sqlite.prepare(`update ${t.table} set ${t.column} = ? where id = ?`).run(to, row.id);
      } catch (err) {
        fail(err instanceof ImageError ? err.message : `conversion failed: ${String(err)}`);
      }
    }
  }
  return report;
}
