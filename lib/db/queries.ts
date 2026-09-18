import { db } from "./client";
import {
  extensions,
  extensionVersions,
  authors,
  screenshots,
  themePreviews,
  downloadStats,
  submissions,
  directoryAdmins,
} from "./schema";
import { eq, and, desc, asc, like, sql, or, inArray } from "drizzle-orm";

// Extension queries
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
  status?: string;
  featured?: boolean;
}) {
  const {
    type,
    pluginType,
    tag,
    authorLogin,
    q,
    sort = "newest",
    order = "desc",
    page = 1,
    perPage = 24,
    status = "approved",
    featured,
  } = opts;

  const limit = Math.min(perPage, 100);
  const offset = (page - 1) * limit;

  const conditions = [eq(extensions.status, status as "pending" | "approved" | "rejected" | "suspended" | "archived")];

  if (type) conditions.push(eq(extensions.type, type));
  if (pluginType) conditions.push(eq(extensions.pluginType, pluginType as "hook" | "ui-extension" | "sidebar-app"));
  if (featured !== undefined) conditions.push(eq(extensions.featured, featured));
  // SQLite: tags are stored as JSON array, use json_each to check membership
  if (tag) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM json_each(${extensions.tags}) WHERE json_each.value = ${tag})`
    );
  }
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        like(extensions.name, pattern),
        like(extensions.description, pattern),
        like(extensions.slug, pattern)
      )!
    );
  }

  const orderBy = (() => {
    const dir = order === "asc" ? asc : desc;
    switch (sort) {
      case "downloads":
        return dir(extensions.totalDownloads);
      case "name":
        return dir(extensions.name);
      case "updated":
        return dir(extensions.updatedAt);
      case "newest":
      default:
        return dir(extensions.createdAt);
    }
  })();

  const where = and(...conditions);

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(extensions)
      .leftJoin(authors, eq(extensions.authorId, authors.id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(extensions)
      .where(where),
  ]);

  // If filtering by author login, do a join
  let filteredItems = items;
  if (authorLogin) {
    filteredItems = items.filter(
      (i) => i.authors?.githubLogin === authorLogin
    );
  }

  // Fetch latest approved version for each extension
  const extIds = filteredItems.map((row) => row.extensions.id);
  const latestVersions =
    extIds.length > 0
      ? await db
          .select({
            extensionId: extensionVersions.extensionId,
            version: extensionVersions.version,
          })
          .from(extensionVersions)
          .where(
            and(
              inArray(extensionVersions.extensionId, extIds),
              eq(extensionVersions.reviewStatus, "approved")
            )
          )
          .orderBy(desc(extensionVersions.createdAt))
      : [];

  // Keep only the first (latest) version per extension
  const versionMap = new Map<string, string>();
  for (const v of latestVersions) {
    if (!versionMap.has(v.extensionId)) {
      versionMap.set(v.extensionId, v.version);
    }
  }

  return {
    data: filteredItems.map((row) => ({
      ...row.extensions,
      author: row.authors,
      latestVersion: versionMap.get(row.extensions.id) ?? null,
    })),
    meta: {
      page,
      perPage: limit,
      total: countResult[0]?.count ?? 0,
    },
  };
}

export async function getExtensionBySlug(slug: string) {
  const result = await db
    .select()
    .from(extensions)
    .leftJoin(authors, eq(extensions.authorId, authors.id))
    .where(eq(extensions.slug, slug))
    .limit(1);

  if (result.length === 0) return null;

  const ext = result[0];

  const [versions, screenshotList, previews] = await Promise.all([
    db
      .select()
      .from(extensionVersions)
      .where(
        and(
          eq(extensionVersions.extensionId, ext.extensions.id),
          eq(extensionVersions.reviewStatus, "approved")
        )
      )
      .orderBy(desc(extensionVersions.createdAt)),
    db
      .select()
      .from(screenshots)
      .where(eq(screenshots.extensionId, ext.extensions.id))
      .orderBy(asc(screenshots.sortOrder)),
    ext.extensions.type === "theme"
      ? db
          .select()
          .from(themePreviews)
          .where(eq(themePreviews.extensionId, ext.extensions.id))
      : Promise.resolve([]),
  ]);

  return {
    ...ext.extensions,
    author: ext.authors,
    versions,
    screenshots: screenshotList,
    themePreviews: previews,
    latestVersion: versions[0] ?? null,
  };
}

export async function getExtensionVersions(extensionId: string) {
  return db
    .select()
    .from(extensionVersions)
    .where(
      and(
        eq(extensionVersions.extensionId, extensionId),
        eq(extensionVersions.reviewStatus, "approved")
      )
    )
    .orderBy(desc(extensionVersions.createdAt));
}

export async function getVersion(extensionId: string, version: string) {
  const result = await db
    .select()
    .from(extensionVersions)
    .where(
      and(
        eq(extensionVersions.extensionId, extensionId),
        eq(extensionVersions.version, version)
      )
    )
    .limit(1);
  return result[0] ?? null;
}

export async function recordDownload(
  extensionId: string,
  versionId: string,
  userAgent: string | null,
  ipHash: string | null
) {
  await db.insert(downloadStats).values({
    extensionId,
    versionId,
    userAgent,
    ipHash,
  });
  await db
    .update(extensions)
    .set({ totalDownloads: sql`${extensions.totalDownloads} + 1` })
    .where(eq(extensions.id, extensionId));
}

// Featured / recent / popular
export async function getFeaturedExtensions(limit = 8) {
  const result = await db
    .select()
    .from(extensions)
    .leftJoin(authors, eq(extensions.authorId, authors.id))
    .where(
      and(eq(extensions.status, "approved"), eq(extensions.featured, true))
    )
    .orderBy(desc(extensions.totalDownloads))
    .limit(limit);

  return result.map((row) => ({ ...row.extensions, author: row.authors }));
}

export async function getRecentExtensions(limit = 12) {
  const result = await db
    .select()
    .from(extensions)
    .leftJoin(authors, eq(extensions.authorId, authors.id))
    .where(eq(extensions.status, "approved"))
    .orderBy(desc(extensions.createdAt))
    .limit(limit);

  return result.map((row) => ({ ...row.extensions, author: row.authors }));
}

export async function getPopularExtensions(limit = 12) {
  const result = await db
    .select()
    .from(extensions)
    .leftJoin(authors, eq(extensions.authorId, authors.id))
    .where(eq(extensions.status, "approved"))
    .orderBy(desc(extensions.totalDownloads))
    .limit(limit);

  return result.map((row) => ({ ...row.extensions, author: row.authors }));
}

export async function getStats() {
  const [extCount, pluginCount, themeCount, authorCount, downloadCount] =
    await Promise.all([
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(extensions)
        .where(eq(extensions.status, "approved")),
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(extensions)
        .where(
          and(
            eq(extensions.status, "approved"),
            eq(extensions.type, "plugin")
          )
        ),
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(extensions)
        .where(
          and(eq(extensions.status, "approved"), eq(extensions.type, "theme"))
        ),
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(authors),
      db
        .select({
          total: sql<number>`cast(coalesce(sum(${extensions.totalDownloads}), 0) as integer)`,
        })
        .from(extensions),
    ]);

  return {
    extensions: extCount[0]?.count ?? 0,
    plugins: pluginCount[0]?.count ?? 0,
    themes: themeCount[0]?.count ?? 0,
    authors: authorCount[0]?.count ?? 0,
    totalDownloads: downloadCount[0]?.total ?? 0,
  };
}

// Check updates
export async function checkUpdates(
  installed: { slug: string; version: string }[]
) {
  const slugs = installed.map((i) => i.slug);
  if (slugs.length === 0) return { updates: [], upToDate: [] };

  const exts = await db
    .select()
    .from(extensions)
    .where(
      and(eq(extensions.status, "approved"), inArray(extensions.slug, slugs))
    );

  const updates: {
    slug: string;
    currentVersion: string;
    latestVersion: string;
    changelog: string | null;
    downloadUrl: string;
  }[] = [];
  const upToDate: string[] = [];

  for (const ext of exts) {
    const inst = installed.find((i) => i.slug === ext.slug);
    if (!inst) continue;

    const latestVersion = await db
      .select()
      .from(extensionVersions)
      .where(
        and(
          eq(extensionVersions.extensionId, ext.id),
          eq(extensionVersions.reviewStatus, "approved")
        )
      )
      .orderBy(desc(extensionVersions.createdAt))
      .limit(1);

    if (latestVersion.length === 0) {
      upToDate.push(ext.slug);
      continue;
    }

    const latest = latestVersion[0];
    if (latest.version === inst.version) {
      upToDate.push(ext.slug);
    } else {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
      updates.push({
        slug: ext.slug,
        currentVersion: inst.version,
        latestVersion: latest.version,
        changelog: latest.changelog,
        downloadUrl: `${siteUrl}/api/v1/bundle/${ext.slug}/${latest.version}`,
      });
    }
  }

  return { updates, upToDate };
}

// Author queries
export async function getAuthorByGithubId(githubId: number) {
  const result = await db
    .select()
    .from(authors)
    .where(eq(authors.githubId, githubId))
    .limit(1);
  return result[0] ?? null;
}

export async function getAuthorByLogin(login: string) {
  const result = await db
    .select()
    .from(authors)
    .where(eq(authors.githubLogin, login))
    .limit(1);
  return result[0] ?? null;
}

// Admin queries
export async function getAdminByGithubId(githubId: number) {
  const result = await db
    .select()
    .from(directoryAdmins)
    .where(eq(directoryAdmins.githubId, githubId))
    .limit(1);
  return result[0] ?? null;
}

export async function getPendingSubmissions() {
  return db
    .select()
    .from(submissions)
    .leftJoin(authors, eq(submissions.authorId, authors.id))
    .leftJoin(extensions, eq(submissions.extensionId, extensions.id))
    .where(
      or(
        eq(submissions.status, "pending"),
        eq(submissions.status, "scanning"),
        eq(submissions.status, "review")
      )
    )
    .orderBy(asc(submissions.submittedAt));
}

// Author dashboard queries
export async function getExtensionsByAuthorId(authorId: string) {
  const rows = await db
    .select()
    .from(extensions)
    .where(eq(extensions.authorId, authorId))
    .orderBy(desc(extensions.updatedAt));

  if (rows.length === 0) return [];

  const extIds = rows.map((r) => r.id);

  // Latest approved version per extension (for "currently published" badge)
  const approvedVersions = await db
    .select({
      extensionId: extensionVersions.extensionId,
      version: extensionVersions.version,
      publishedAt: extensionVersions.publishedAt,
    })
    .from(extensionVersions)
    .where(
      and(
        inArray(extensionVersions.extensionId, extIds),
        eq(extensionVersions.reviewStatus, "approved")
      )
    )
    .orderBy(desc(extensionVersions.publishedAt));

  const latestApproved = new Map<string, { version: string; publishedAt: Date | null }>();
  for (const v of approvedVersions) {
    if (!latestApproved.has(v.extensionId)) {
      latestApproved.set(v.extensionId, {
        version: v.version,
        publishedAt: v.publishedAt,
      });
    }
  }

  // Open (pending/scanning/review) submission per extension — used to prevent
  // double-submits and to surface "review in progress" on the dashboard.
  const openSubs = await db
    .select()
    .from(submissions)
    .where(
      and(
        inArray(submissions.extensionId, extIds),
        or(
          eq(submissions.status, "pending"),
          eq(submissions.status, "scanning"),
          eq(submissions.status, "review")
        )
      )
    )
    .orderBy(desc(submissions.submittedAt));

  const openSubMap = new Map<string, (typeof openSubs)[number]>();
  for (const s of openSubs) {
    if (s.extensionId && !openSubMap.has(s.extensionId)) {
      openSubMap.set(s.extensionId, s);
    }
  }

  // Most recent submission per extension (any status) — used to prefill the
  // update-version dialog with the repo/subpath the author last used.
  const latestSubs = await db
    .select()
    .from(submissions)
    .where(inArray(submissions.extensionId, extIds))
    .orderBy(desc(submissions.submittedAt));

  const latestSubMap = new Map<string, (typeof latestSubs)[number]>();
  for (const s of latestSubs) {
    if (s.extensionId && !latestSubMap.has(s.extensionId)) {
      latestSubMap.set(s.extensionId, s);
    }
  }

  return rows.map((ext) => ({
    ...ext,
    latestVersion: latestApproved.get(ext.id) ?? null,
    openSubmission: openSubMap.get(ext.id) ?? null,
    lastSubmission: latestSubMap.get(ext.id) ?? null,
  }));
}

export async function getSubmissionsByAuthorId(authorId: string, limit = 20) {
  return db
    .select()
    .from(submissions)
    .leftJoin(extensions, eq(submissions.extensionId, extensions.id))
    .where(eq(submissions.authorId, authorId))
    .orderBy(desc(submissions.submittedAt))
    .limit(limit);
}
