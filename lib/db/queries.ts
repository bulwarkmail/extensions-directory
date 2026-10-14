// Read helpers for the public pages and the older v1 list routes, built on
// the release lifecycle in lib/catalog.ts ("latest" = highest stable,
// non-yanked version).
import { db } from "./client";
import { authors, extensions } from "./schema";
import { desc, eq, sql, and } from "drizzle-orm";
import { extensionBySlug, latestFor, listExtensions, mediaOf, releasesOf, type Version } from "@/lib/catalog";

type Ext = typeof extensions.$inferSelect;
type Author = typeof authors.$inferSelect;

function withLatest(rows: { e: Ext; a: Author | null }[]) {
  const releases = releasesOf(rows.map((r) => r.e.id));
  return rows.map(({ e, a }) => ({ ...e, author: a, latestVersion: latestFor(releases.get(e.id) ?? [], { channel: "stable" })?.version ?? null }));
}

export async function getExtensions(opts: {
  type?: "plugin" | "theme";
  pluginType?: string;
  tag?: string;
  authorLogin?: string;
  q?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  perPage?: number;
  featured?: boolean;
}) {
  const { rows, total, page, perPage } = listExtensions({ ...opts, author: opts.authorLogin });
  return { data: withLatest(rows), meta: { page, perPage, total } };
}

/** An extension with its listed (stable, not yanked) versions, highest first. */
export async function getExtensionBySlug(slug: string) {
  const row = extensionBySlug(slug);
  if (!row) return null;
  const all = releasesOf([row.e.id]).get(row.e.id) ?? [];
  const versions: Version[] = all.filter((v) => v.channel === "stable" && !v.yankedAt);
  const media = mediaOf(row.e.id);
  return {
    ...row.e,
    author: row.a,
    versions,
    allVersions: all,
    screenshots: media.screenshots,
    themePreviews: media.themePreviews,
    latestVersion: latestFor(all, { channel: "stable" }),
  };
}

const listed = (order: ReturnType<typeof desc>, limit: number, featured?: boolean) =>
  withLatest(
    db.select({ e: extensions, a: authors }).from(extensions).leftJoin(authors, eq(extensions.authorId, authors.id))
      .where(and(eq(extensions.status, "approved"), featured ? eq(extensions.featured, true) : undefined))
      .orderBy(sql`${extensions.deprecatedAt} is not null`, order).limit(limit).all()
  );

export async function getFeaturedExtensions(limit = 8) {
  return listed(desc(extensions.totalDownloads), limit, true);
}

export async function getRecentExtensions(limit = 12) {
  return listed(desc(extensions.createdAt), limit);
}

export async function getPopularExtensions(limit = 12) {
  return listed(desc(extensions.totalDownloads), limit);
}

export async function getStats() {
  const one = (q: ReturnType<typeof sql>) => (db.get(q) as { n: number }).n;
  return {
    extensions: one(sql`select count(*) n from extensions where status = 'approved'`),
    plugins: one(sql`select count(*) n from extensions where status = 'approved' and type = 'plugin'`),
    themes: one(sql`select count(*) n from extensions where status = 'approved' and type = 'theme'`),
    authors: one(sql`select count(*) n from authors`),
    totalDownloads: one(sql`select coalesce(sum(total_downloads), 0) n from extensions`),
  };
}

export async function getAuthorByLogin(login: string) {
  return db.select().from(authors).where(eq(authors.githubLogin, login)).get() ?? null;
}
