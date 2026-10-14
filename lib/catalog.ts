// What the public sees: listed extensions and their releases, with the
// release lifecycle applied (channels, yanked versions, app compatibility).
// Shared by /api/v1, /api/v2 and the pages.
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db/client";
import { advisories, authors, extensions, extensionVersions, ratings, screenshots, themePreviews } from "./db/schema";
import { appVersionFits, compare, satisfies } from "./semver";

export type Channel = "stable" | "beta";
export type Version = typeof extensionVersions.$inferSelect;
export type Extension = typeof extensions.$inferSelect;

export interface ReleaseFilter {
  /** The caller's app version; versions it can't run are skipped. */
  appVersion?: string | null;
  channel?: Channel;
  includeYanked?: boolean;
}

/** Approved versions of extensions, highest first. */
export function releasesOf(extensionIds: string[]): Map<string, Version[]> {
  const out = new Map<string, Version[]>();
  if (!extensionIds.length) return out;
  const rows = db.select().from(extensionVersions)
    .where(and(inArray(extensionVersions.extensionId, extensionIds), eq(extensionVersions.reviewStatus, "approved"))).all();
  for (const r of rows) out.set(r.extensionId, [...(out.get(r.extensionId) ?? []), r]);
  for (const list of out.values()) list.sort((a, b) => compare(b.version, a.version));
  return out;
}

export function visible(v: Version, f: ReleaseFilter): boolean {
  if (v.yankedAt && !f.includeYanked) return false;
  if (v.channel === "beta" && (f.channel ?? "stable") !== "beta") return false;
  return true;
}

/** The version a caller should install: highest visible one it can run. */
export function latestFor(versions: Version[], f: ReleaseFilter): Version | null {
  return versions.find((v) => visible(v, f) && appVersionFits(f.appVersion, v.minAppVersion, v.maxAppVersion)) ?? null;
}

/** The highest visible version regardless of app version. */
export function newest(versions: Version[], f: ReleaseFilter): Version | null {
  return versions.find((v) => visible(v, f)) ?? null;
}

export interface ListOptions {
  type?: "plugin" | "theme";
  pluginType?: string;
  tag?: string;
  author?: string;
  q?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  perPage?: number;
  featured?: boolean;
}

export function listExtensions(opts: ListOptions) {
  const perPage = Math.min(Math.max(1, Number(opts.perPage) || 24), 100);
  const page = Math.max(1, Number(opts.page) || 1);
  const where: SQL[] = [eq(extensions.status, "approved")];
  if (opts.type === "plugin" || opts.type === "theme") where.push(eq(extensions.type, opts.type));
  if (opts.pluginType) where.push(eq(extensions.pluginType, opts.pluginType as "hook"));
  if (opts.featured !== undefined) where.push(eq(extensions.featured, opts.featured));
  if (opts.tag) where.push(sql`exists (select 1 from json_each(${extensions.tags}) where json_each.value = ${opts.tag})`);
  if (opts.author) where.push(eq(authors.githubLogin, opts.author));
  if (opts.q) {
    const p = `%${opts.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(or(sql`${extensions.name} like ${p} escape '\\'`, sql`${extensions.description} like ${p} escape '\\'`, sql`${extensions.slug} like ${p} escape '\\'`)!);
  }
  const dir = opts.order === "asc" ? asc : desc;
  // Deprecated extensions sink below the others whatever the sort.
  const order = [
    sql`${extensions.deprecatedAt} is not null`,
    opts.sort === "downloads" ? dir(extensions.totalDownloads)
      : opts.sort === "name" ? dir(extensions.name)
      : opts.sort === "updated" ? dir(extensions.updatedAt)
      : dir(extensions.createdAt),
  ];
  const cond = and(...where);
  const rows = db.select({ e: extensions, a: authors }).from(extensions).leftJoin(authors, eq(authors.id, extensions.authorId))
    .where(cond).orderBy(...order).limit(perPage).offset((page - 1) * perPage).all();
  const total = db.select({ n: sql<number>`count(*)` }).from(extensions).leftJoin(authors, eq(authors.id, extensions.authorId)).where(cond).get()!.n;
  return { rows, total, page, perPage };
}

export function ratingSummary(extensionIds: string[]): Map<string, { average: number; count: number }> {
  const out = new Map<string, { average: number; count: number }>();
  if (!extensionIds.length) return out;
  const rows = db.select({ id: ratings.extensionId, avg: sql<number>`avg(${ratings.stars})`, n: sql<number>`count(*)` })
    .from(ratings).where(and(inArray(ratings.extensionId, extensionIds), isNull(ratings.hiddenAt))).groupBy(ratings.extensionId).all();
  for (const r of rows) out.set(r.id, { average: Math.round(r.avg * 10) / 10, count: r.n });
  return out;
}

export function extensionBySlug(slug: string) {
  return db.select({ e: extensions, a: authors }).from(extensions).leftJoin(authors, eq(authors.id, extensions.authorId)).where(eq(extensions.slug, slug)).get() ?? null;
}

export function mediaOf(extensionId: string) {
  return {
    screenshots: db.select().from(screenshots).where(eq(screenshots.extensionId, extensionId)).orderBy(asc(screenshots.sortOrder)).all(),
    themePreviews: db.select().from(themePreviews).where(eq(themePreviews.extensionId, extensionId)).all(),
  };
}

export type Advisory = typeof advisories.$inferSelect;

/** Published advisories of an extension; with a version, only those that affect it. */
export function advisoriesFor(extensionId: string, version?: string): Advisory[] {
  const rows = db.select().from(advisories)
    .where(and(eq(advisories.extensionId, extensionId), isNull(advisories.withdrawnAt), sql`${advisories.publishedAt} is not null`)).all();
  return version ? rows.filter((a) => satisfies(version, a.affected)) : rows;
}

