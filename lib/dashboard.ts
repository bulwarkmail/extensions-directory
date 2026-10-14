// Data for the author dashboard and the admin pages (server components).
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  advisories, apiTokens, auditLog, authors, extensionMembers, extensions, extensionVersions, publishers, ratings, reports, submissions,
  textChanges, webhooks, OPEN_STATUSES,
} from "./db/schema";
import { releasesOf } from "./catalog";
import { memberRole } from "./auth/guard";
import { tokensOf } from "./auth/tokens";
import { downloadsByDay } from "./downloads";
import type { SessionUser } from "./auth/session";
import { hasRole } from "./auth/session";

export function myExtensions(userId: string) {
  const rows = db.select({ e: extensions, role: extensionMembers.role }).from(extensionMembers)
    .innerJoin(extensions, eq(extensions.id, extensionMembers.extensionId))
    .where(eq(extensionMembers.authorId, userId)).orderBy(desc(extensions.updatedAt)).all();
  const releases = releasesOf(rows.map((r) => r.e.id));
  const open = rows.length
    ? db.select().from(submissions).where(and(inArray(submissions.extensionId, rows.map((r) => r.e.id)), inArray(submissions.status, OPEN_STATUSES), eq(submissions.dryRun, false))).all()
    : [];
  return rows.map(({ e, role }) => ({ ext: e, role, latest: (releases.get(e.id) ?? []).find((v) => !v.yankedAt) ?? null, open: open.filter((s) => s.extensionId === e.id) }));
}

export function mySubmissions(userId: string, limit = 15) {
  return db.select({ s: submissions, slug: extensions.slug }).from(submissions).leftJoin(extensions, eq(extensions.id, submissions.extensionId))
    .where(eq(submissions.authorId, userId)).orderBy(desc(submissions.submittedAt)).limit(limit).all();
}

/** Everything the manage page shows, if the user may manage the extension. */
export async function manageData(slug: string, user: SessionUser) {
  const ext = db.select().from(extensions).where(eq(extensions.slug, slug)).get();
  if (!ext) return null;
  const role = await memberRole(user.id, ext.id);
  const staff = hasRole(user.role, "admin");
  if (!role && !staff) return null;
  return {
    ext,
    role,
    staff,
    versions: releasesOf([ext.id]).get(ext.id) ?? [],
    members: db.select({ authorId: extensionMembers.authorId, role: extensionMembers.role, login: authors.githubLogin, name: authors.displayName })
      .from(extensionMembers).innerJoin(authors, eq(authors.id, extensionMembers.authorId)).where(eq(extensionMembers.extensionId, ext.id)).all(),
    publishers: db.select().from(publishers).where(eq(publishers.extensionId, ext.id)).all(),
    submissions: db.select().from(submissions).where(eq(submissions.extensionId, ext.id)).orderBy(desc(submissions.submittedAt)).limit(30).all(),
    textChanges: db.select().from(textChanges).where(eq(textChanges.extensionId, ext.id)).orderBy(desc(textChanges.proposedAt)).limit(20).all(),
  };
}

export async function submissionFor(id: string, user: SessionUser) {
  const s = db.select().from(submissions).where(eq(submissions.id, id)).get();
  if (!s) return null;
  const ext = s.extensionId ? db.select().from(extensions).where(eq(extensions.id, s.extensionId)).get() ?? null : null;
  const allowed = hasRole(user.role, "reviewer") || s.authorId === user.id || (ext && (await memberRole(user.id, ext.id)));
  return allowed ? { s, ext } : null;
}

export function myTokens(userId: string) {
  const now = Date.now();
  return tokensOf(userId).map((t) => ({ ...t, expired: t.expiresAt.getTime() < now }));
}

/** Downloads per version over the last 30 days. */
export function downloadsLast30(extensionId: string): Map<string, number> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const out = new Map<string, number>();
  for (const d of downloadsByDay(extensionId, since)) out.set(d.version, (out.get(d.version) ?? 0) + d.count);
  return out;
}

export function myWebhooks(userId: string) {
  return db.select({ id: webhooks.id, url: webhooks.url, events: webhooks.events, lastDeliveryAt: webhooks.lastDeliveryAt, lastStatus: webhooks.lastStatus }).from(webhooks).where(eq(webhooks.authorId, userId)).all();
}

export function adminCounts() {
  const n = (q: ReturnType<typeof sql>) => (db.get(q) as { n: number }).n;
  return {
    awaitingReview: n(sql`select count(*) n from submissions where status = 'awaiting_review' and dry_run = 0`),
    building: n(sql`select count(*) n from submissions where status in ('queued', 'building', 'publishing') and dry_run = 0`),
    textChanges: n(sql`select count(*) n from text_changes where status = 'pending'`),
    openReports: n(sql`select count(*) n from reports where status = 'open'`),
    extensions: n(sql`select count(*) n from extensions where status = 'approved'`),
    authors: n(sql`select count(*) n from authors`),
    unsigned: n(sql`select count(*) n from extension_versions where signature is null`),
  };
}

export function reviewQueue(status: string) {
  return db.select({ s: submissions, login: authors.githubLogin, name: extensions.name, extStatus: extensions.status })
    .from(submissions).leftJoin(authors, eq(authors.id, submissions.authorId)).leftJoin(extensions, eq(extensions.id, submissions.extensionId))
    .where(and(status === "all" ? undefined : eq(submissions.status, status as "queued"), eq(submissions.dryRun, false)))
    .orderBy(status === "awaiting_review" ? submissions.submittedAt : desc(submissions.submittedAt)).limit(200).all();
}

export function pendingTextChanges() {
  return db.select({ t: textChanges, slug: extensions.slug, login: authors.githubLogin }).from(textChanges)
    .innerJoin(extensions, eq(extensions.id, textChanges.extensionId)).leftJoin(authors, eq(authors.id, textChanges.proposedBy))
    .where(eq(textChanges.status, "pending")).orderBy(textChanges.proposedAt).all();
}

export function allExtensions() {
  return db.select({ e: extensions, login: authors.githubLogin }).from(extensions).leftJoin(authors, eq(authors.id, extensions.authorId)).orderBy(desc(extensions.updatedAt)).all();
}

export function allAuthors(q?: string) {
  return db.select().from(authors).where(q ? sql`${authors.githubLogin} like ${`%${q}%`}` : undefined).orderBy(desc(authors.createdAt)).limit(500).all();
}

export function allReports(status: string) {
  return db.select({ r: reports, slug: extensions.slug }).from(reports).innerJoin(extensions, eq(extensions.id, reports.extensionId))
    .where(status === "all" ? undefined : eq(reports.status, status as "open")).orderBy(desc(reports.createdAt)).limit(300).all();
}

export function allRatings() {
  return db.select({ r: ratings, slug: extensions.slug, login: authors.githubLogin }).from(ratings)
    .innerJoin(extensions, eq(extensions.id, ratings.extensionId)).innerJoin(authors, eq(authors.id, ratings.authorId)).orderBy(desc(ratings.updatedAt)).limit(300).all();
}

export function allAdvisories() {
  return db.select({ a: advisories, slug: extensions.slug }).from(advisories).innerJoin(extensions, eq(extensions.id, advisories.extensionId)).orderBy(desc(advisories.createdAt)).all();
}

export function allTokens() {
  return db.select({ t: apiTokens, login: authors.githubLogin }).from(apiTokens).innerJoin(authors, eq(authors.id, apiTokens.authorId)).orderBy(desc(apiTokens.createdAt)).limit(500).all();
}

export function auditEntries(opts: { action?: string; target?: string; page: number }) {
  const conds = [opts.action ? sql`${auditLog.action} like ${`${opts.action}%`}` : undefined, opts.target ? eq(auditLog.targetId, opts.target) : undefined].filter(Boolean);
  return db.select({ l: auditLog, login: authors.githubLogin }).from(auditLog).leftJoin(authors, eq(authors.id, auditLog.actorId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(auditLog.id)).limit(100).offset((opts.page - 1) * 100).all();
}

export function versionOf(extensionId: string, version: string) {
  return db.select().from(extensionVersions).where(and(eq(extensionVersions.extensionId, extensionId), eq(extensionVersions.version, version))).get() ?? null;
}
