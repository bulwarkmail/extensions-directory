// Cached "latest" pointers on extensions, so lists don't have to sort every
// extension's versions. Refreshed after approval, yank and unyank, and once
// for all extensions after the 0003 migration (SQLite can't order semver).
//
// latest_stable_version_id: highest approved, non-yanked stable version.
// latest_beta_version_id:   highest approved, non-yanked version of any
//                           channel (what someone on the beta channel gets).
// The extension-level permissions and min_app_version mirror the latest
// stable version, as v1 has always reported them.
import type Database from "better-sqlite3";
import { compare } from "./semver";

interface Row {
  id: string;
  extension_id: string;
  version: string;
  channel: string;
  permissions: string | null;
  min_app_version: string | null;
}

export function refreshLatest(sqlite: Database.Database, extensionId?: string): number {
  const rows = sqlite
    .prepare(
      `select id, extension_id, version, channel, permissions, min_app_version
       from extension_versions
       where review_status = 'approved' and yanked_at is null ${extensionId ? "and extension_id = ?" : ""}`
    )
    .all(...(extensionId ? [extensionId] : [])) as Row[];

  const byExt = new Map<string, Row[]>();
  for (const r of rows) byExt.set(r.extension_id, [...(byExt.get(r.extension_id) ?? []), r]);
  const ids = extensionId
    ? [extensionId]
    : (sqlite.prepare("select id from extensions").all() as { id: string }[]).map((r) => r.id);

  const update = sqlite.prepare(
    `update extensions set latest_stable_version_id = ?, latest_beta_version_id = ?,
       permissions = coalesce(?, permissions), min_app_version = case when ? is null then min_app_version else ? end
     where id = ?`
  );
  const tx = sqlite.transaction(() => {
    for (const id of ids) {
      const versions = (byExt.get(id) ?? []).sort((a, b) => compare(b.version, a.version));
      const stable = versions.find((v) => v.channel === "stable") ?? null;
      const beta = versions[0] ?? null;
      update.run(stable?.id ?? null, beta?.id ?? null, stable?.permissions ?? null, stable?.id ?? null, stable?.min_app_version ?? null, id);
    }
  });
  tx();
  return ids.length;
}
