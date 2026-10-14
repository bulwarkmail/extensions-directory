// v1 answers built on the release lifecycle (lib/catalog.ts): "latest" is
// the highest stable, non-yanked version (that the caller can run, when it
// says which app version it is), and betas and yanked versions stay out of
// lists. Their bundles still download by exact version.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { extensions } from "@/lib/db/schema";
import { latestFor, listExtensions, releasesOf, extensionBySlug, mediaOf, type Version } from "@/lib/catalog";
import { compare, isValid } from "@/lib/semver";
import { v1Detail, v1ListItem } from "./serialize";

export function appVersionOf(q: URLSearchParams | { appVersion?: unknown }): string | null {
  const v = q instanceof URLSearchParams ? q.get("appVersion") : q.appVersion;
  return typeof v === "string" && isValid(v) ? v : null;
}

/** Versions v1 lists: stable and not yanked, highest first. */
export function listedVersions(all: Version[]): Version[] {
  return all.filter((v) => v.channel === "stable" && !v.yankedAt);
}

export function v1List(q: URLSearchParams) {
  const appVersion = appVersionOf(q);
  const { rows, total, page, perPage } = listExtensions({
    type: (q.get("type") as "plugin") || undefined, pluginType: q.get("pluginType") || undefined, tag: q.get("tag") || undefined,
    author: q.get("author") || undefined, q: q.get("q") || undefined, sort: q.get("sort") || "newest",
    order: q.get("order") === "asc" ? "asc" : "desc", page: Number(q.get("page")) || 1, perPage: Number(q.get("perPage")) || 24,
  });
  const releases = releasesOf(rows.map((r) => r.e.id));
  return {
    data: rows.map(({ e, a }) => {
      const latest = latestFor(releases.get(e.id) ?? [], { appVersion, channel: "stable" });
      const ext = latest ? { ...e, permissions: latest.permissions, minAppVersion: latest.minAppVersion } : e;
      return v1ListItem({ ...ext, author: a, latestVersion: latest?.version ?? null }, true);
    }),
    meta: { page, perPage, total },
  };
}

export function v1ExtensionDetail(slug: string, appVersion: string | null) {
  const row = extensionBySlug(slug);
  if (!row || row.e.status !== "approved") return null;
  const all = releasesOf([row.e.id]).get(row.e.id) ?? [];
  const latest = latestFor(all, { appVersion, channel: "stable" });
  const media = mediaOf(row.e.id);
  const ext = latest ? { ...row.e, permissions: latest.permissions, minAppVersion: latest.minAppVersion } : row.e;
  return v1Detail({ ...ext, author: row.a, versions: listedVersions(all), screenshots: media.screenshots, themePreviews: media.themePreviews, latestVersion: latest });
}

export function v1CheckUpdates(installed: { slug: string; version: string }[], appVersion: string | null) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  const updates: { slug: string; currentVersion: string; latestVersion: string; changelog: string | null; downloadUrl: string }[] = [];
  const upToDate: string[] = [];
  for (const inst of installed) {
    const ext = db.select().from(extensions).where(eq(extensions.slug, inst.slug)).get();
    if (!ext || ext.status !== "approved") continue;
    const latest = latestFor(releasesOf([ext.id]).get(ext.id) ?? [], { appVersion, channel: "stable" });
    // Only ever offer something newer than what is installed.
    if (!latest || !isValid(inst.version) || compare(latest.version, inst.version) <= 0) {
      upToDate.push(ext.slug);
      continue;
    }
    updates.push({ slug: ext.slug, currentVersion: inst.version, latestVersion: latest.version, changelog: latest.changelog, downloadUrl: `${siteUrl}/api/v1/bundle/${ext.slug}/${latest.version}` });
  }
  return { updates, upToDate };
}
