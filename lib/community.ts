// Ratings (signed-in GitHub accounts), abuse reports (anyone) and security
// advisories (staff), with moderation.
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "./db/client";
import { advisories, authors, extensionMembers, extensions, ratings, REPORT_REASONS, reports, SEVERITIES } from "./db/schema";
import { HttpError } from "./auth/session";
import { audit, type Actor } from "./audit";
import { queueNotification } from "./notify";
import { isValid, isValidRange } from "./semver";

type Ext = typeof extensions.$inferSelect;

// ── ratings ──────────────────────────────────────────────────────────────────

export async function rate(ext: Ext, authorId: string, stars: number, body: string | null) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, "Stars must be 1 to 5", "bad_request");
  if (body && body.length > 2000) throw new HttpError(400, "Keep the review under 2000 characters", "bad_request");
  if (ext.status !== "approved") throw new HttpError(404, "Extension not found", "not_found");
  const member = db.select().from(extensionMembers).where(and(eq(extensionMembers.extensionId, ext.id), eq(extensionMembers.authorId, authorId))).get();
  if (member) throw new HttpError(403, "You can't rate your own extension", "forbidden");
  await db.insert(ratings).values({ extensionId: ext.id, authorId, stars, body: body?.trim() || null })
    .onConflictDoUpdate({ target: [ratings.extensionId, ratings.authorId], set: { stars, body: body?.trim() || null, updatedAt: new Date() } });
}

export async function removeRating(ext: Ext, authorId: string) {
  await db.delete(ratings).where(and(eq(ratings.extensionId, ext.id), eq(ratings.authorId, authorId)));
}

export function ratingsOf(extensionId: string, limit = 50) {
  return db.select({ id: ratings.id, stars: ratings.stars, body: ratings.body, createdAt: ratings.createdAt, updatedAt: ratings.updatedAt, login: authors.githubLogin, name: authors.displayName, avatarUrl: authors.avatarUrl })
    .from(ratings).innerJoin(authors, eq(authors.id, ratings.authorId))
    .where(and(eq(ratings.extensionId, extensionId), isNull(ratings.hiddenAt))).orderBy(desc(ratings.updatedAt)).limit(limit).all();
}

export async function hideRating(id: string, hidden: boolean, actor: Actor, request?: Request) {
  const res = db.update(ratings).set({ hiddenAt: hidden ? new Date() : null, hiddenBy: hidden ? actor.id ?? null : null }).where(eq(ratings.id, id)).run();
  if (res.changes !== 1) throw new HttpError(404, "Rating not found", "not_found");
  await audit(actor, hidden ? "rating.hide" : "rating.unhide", { kind: "rating", id }, {}, request);
}

// ── reports ──────────────────────────────────────────────────────────────────

export interface ReportInput {
  reason: string;
  details: string;
  version?: string | null;
  contactEmail?: string | null;
  reporterId?: string | null;
  ipHash: string | null;
}

export async function report(ext: Ext, r: ReportInput, staffIds: () => string[]) {
  if (!REPORT_REASONS.includes(r.reason as never)) throw new HttpError(400, `Reason must be one of ${REPORT_REASONS.join(", ")}`, "bad_request");
  const details = r.details.trim();
  if (details.length < 10 || details.length > 5000) throw new HttpError(400, "Describe the problem in 10 to 5000 characters", "bad_request");
  if (r.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.contactEmail)) throw new HttpError(400, "That email address doesn't look right", "bad_request");
  if (r.version && !isValid(r.version)) throw new HttpError(400, "Not a version", "bad_request");
  // The same report again (same reason from the same address today) is folded in.
  const dayAgo = new Date(Date.now() - 86_400_000);
  const dup = db.select().from(reports).where(and(eq(reports.extensionId, ext.id), eq(reports.reason, r.reason as "other"), eq(reports.status, "open"),
    r.reporterId ? eq(reports.reporterId, r.reporterId) : eq(reports.reporterIpHash, r.ipHash ?? ""), gte(reports.createdAt, dayAgo))).get();
  if (dup) {
    await db.update(reports).set({ duplicates: sql`${reports.duplicates} + 1` }).where(eq(reports.id, dup.id));
    return dup;
  }
  const [row] = await db.insert(reports).values({
    extensionId: ext.id, version: r.version ?? null, reporterId: r.reporterId ?? null, reporterIpHash: r.ipHash,
    contactEmail: r.contactEmail ?? null, reason: r.reason as "other", details,
  }).returning();
  await audit(r.reporterId ? { kind: "author", id: r.reporterId } : { kind: "anonymous" }, "report.create", { kind: "report", id: row.id }, { slug: ext.slug, reason: r.reason });
  if (r.reason === "malware") {
    for (const id of staffIds()) await queueNotification(id, "report.malware", { reportId: row.id, slug: ext.slug, details: details.slice(0, 500) });
  }
  return row;
}

export async function handleReport(id: string, status: "actioned" | "dismissed" | "open", notes: string | null, actor: Actor, request?: Request) {
  const res = db.update(reports).set({ status, notes, handledBy: actor.id ?? null, handledAt: new Date() }).where(eq(reports.id, id)).run();
  if (res.changes !== 1) throw new HttpError(404, "Report not found", "not_found");
  await audit(actor, `report.${status}`, { kind: "report", id }, { notes }, request);
}

// ── advisories ───────────────────────────────────────────────────────────────

export interface AdvisoryInput {
  affected: string;
  fixedIn?: string | null;
  severity: string;
  summary: string;
  details?: string;
  publish?: boolean;
}

function checkAdvisory(a: AdvisoryInput) {
  if (!isValidRange(a.affected)) throw new HttpError(400, 'affected must be a version range like ">=1.0.0 <1.2.3"', "bad_request");
  if (a.fixedIn && !isValid(a.fixedIn)) throw new HttpError(400, "fixedIn must be a version", "bad_request");
  if (!SEVERITIES.includes(a.severity as never)) throw new HttpError(400, `severity must be one of ${SEVERITIES.join(", ")}`, "bad_request");
  if (!a.summary.trim() || a.summary.length > 300) throw new HttpError(400, "Give a summary of up to 300 characters", "bad_request");
  if ((a.details ?? "").length > 20_000) throw new HttpError(400, "details is too long", "bad_request");
}

function nextAdvisoryId(): string {
  const year = new Date().getUTCFullYear();
  const n = db.select({ n: sql<number>`count(*)` }).from(advisories).where(sql`${advisories.id} like ${`BWX-${year}-%`}`).get()!.n;
  return `BWX-${year}-${String(n + 1).padStart(4, "0")}`;
}

export async function createAdvisory(ext: Ext, a: AdvisoryInput, actor: Actor, request?: Request) {
  checkAdvisory(a);
  const id = nextAdvisoryId();
  const [row] = await db.insert(advisories).values({
    id, extensionId: ext.id, affected: a.affected, fixedIn: a.fixedIn ?? null, severity: a.severity as "low",
    summary: a.summary.trim(), details: a.details ?? "", publishedAt: a.publish ? new Date() : null, createdBy: actor.id!,
  }).returning();
  await audit(actor, "advisory.create", { kind: "advisory", id }, { slug: ext.slug, affected: a.affected, severity: a.severity, published: !!a.publish }, request);
  if (a.publish) await notifyMaintainers(ext, row);
  return row;
}

export async function updateAdvisory(id: string, patch: Partial<AdvisoryInput> & { withdraw?: boolean }, actor: Actor, request?: Request) {
  const cur = db.select().from(advisories).where(eq(advisories.id, id)).get();
  if (!cur) throw new HttpError(404, "Advisory not found", "not_found");
  const next = { affected: patch.affected ?? cur.affected, fixedIn: patch.fixedIn === undefined ? cur.fixedIn : patch.fixedIn, severity: patch.severity ?? cur.severity, summary: patch.summary ?? cur.summary, details: patch.details ?? cur.details };
  checkAdvisory(next);
  const publishNow = patch.publish && !cur.publishedAt;
  await db.update(advisories).set({ ...next, severity: next.severity as "low", updatedAt: new Date(), ...(publishNow ? { publishedAt: new Date() } : {}), ...(patch.withdraw ? { withdrawnAt: new Date() } : {}) }).where(eq(advisories.id, id));
  await audit(actor, patch.withdraw ? "advisory.withdraw" : publishNow ? "advisory.publish" : "advisory.update", { kind: "advisory", id }, { ...patch }, request);
  if (publishNow) {
    const ext = db.select().from(extensions).where(eq(extensions.id, cur.extensionId)).get()!;
    await notifyMaintainers(ext, { ...cur, ...next });
  }
}

async function notifyMaintainers(ext: Ext, a: { id: string; summary: string }) {
  for (const m of db.select({ id: extensionMembers.authorId }).from(extensionMembers).where(eq(extensionMembers.extensionId, ext.id)).all()) {
    await queueNotification(m.id, "advisory.published", { id: a.id, slug: ext.slug, summary: a.summary });
  }
}

export function advisoryView(a: typeof advisories.$inferSelect, slug: string) {
  return { id: a.id, extension: slug, affected: a.affected, fixedIn: a.fixedIn, severity: a.severity, summary: a.summary, details: a.details, publishedAt: a.publishedAt, updatedAt: a.updatedAt, withdrawn: !!a.withdrawnAt };
}
