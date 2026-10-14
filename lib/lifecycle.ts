// Release lifecycle and moderation: yanking versions, compatibility bounds,
// deprecation, archiving and suspension, text changes that wait for review,
// members, trusted publishers, and staff actions on accounts.
import crypto from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import {
  apiTokens, authors, extensionMembers, extensions, extensionVersions, publishers, ROLES, submissions,
  textChanges, TEXT_FIELDS, type Role, type TextField,
} from "./db/schema";
import { HttpError } from "./auth/session";
import { audit, type Actor } from "./audit";
import { queueNotification } from "./notify";
import { refreshLatest } from "./release-caches";
import { isValid } from "./semver";
import { revokeToken } from "./auth/tokens";
import { source } from "./sources";

type Ext = typeof extensions.$inferSelect;

export function extensionOr404(slug: string): Ext {
  const e = db.select().from(extensions).where(eq(extensions.slug, slug)).get();
  if (!e) throw new HttpError(404, "Extension not found", "not_found");
  return e;
}

function versionOr404(ext: Ext, version: string) {
  const v = db.select().from(extensionVersions).where(and(eq(extensionVersions.extensionId, ext.id), eq(extensionVersions.version, version))).get();
  if (!v) throw new HttpError(404, "Version not found", "not_found");
  return v;
}

// ── versions ─────────────────────────────────────────────────────────────────

export async function yankVersion(ext: Ext, version: string, reason: string, actor: Actor, request?: Request) {
  if (!reason.trim()) throw new HttpError(400, "Give a reason; webmails running this version are shown it", "bad_request");
  const v = versionOr404(ext, version);
  await db.update(extensionVersions).set({ yankedAt: new Date(), yankedBy: actor.id ?? null, yankReason: reason.slice(0, 500) }).where(eq(extensionVersions.id, v.id));
  refreshLatest(db.$client, ext.id);
  await audit(actor, "version.yank", { kind: "version", id: v.id }, { slug: ext.slug, version, reason }, request);
}

export async function unyankVersion(ext: Ext, version: string, actor: Actor, request?: Request) {
  const v = versionOr404(ext, version);
  await db.update(extensionVersions).set({ yankedAt: null, yankedBy: null, yankReason: null }).where(eq(extensionVersions.id, v.id));
  refreshLatest(db.$client, ext.id);
  await audit(actor, "version.unyank", { kind: "version", id: v.id }, { slug: ext.slug, version }, request);
}

/** "Does not work on Bulwark x and later": no review needed, audit-logged. */
export async function setMaxAppVersion(ext: Ext, version: string, max: string | null, actor: Actor, request?: Request) {
  if (max !== null && !isValid(max)) throw new HttpError(400, "maxAppVersion must look like 2.0.0", "bad_request");
  const v = versionOr404(ext, version);
  await db.update(extensionVersions).set({ maxAppVersion: max }).where(eq(extensionVersions.id, v.id));
  await audit(actor, "version.max_app_version", { kind: "version", id: v.id }, { slug: ext.slug, version, max }, request);
}

// ── extensions ───────────────────────────────────────────────────────────────

export async function deprecate(ext: Ext, message: string, replacement: string | null, actor: Actor, request?: Request) {
  if (replacement) {
    const r = db.select({ id: extensions.id, status: extensions.status }).from(extensions).where(eq(extensions.slug, replacement)).get();
    if (!r || r.status !== "approved" || replacement === ext.slug) throw new HttpError(400, "The replacement must be another listed extension", "bad_request");
  }
  // The message is public text: it goes live once a reviewer approves it.
  await db.update(extensions).set({ deprecatedAt: new Date(), replacementSlug: replacement, updatedAt: new Date() }).where(eq(extensions.id, ext.id));
  if (message.trim()) await proposeTextChange(ext, "deprecation_message", message.trim(), null, actor, request);
  await audit(actor, "extension.deprecate", { kind: "extension", id: ext.id }, { slug: ext.slug, replacement }, request);
}

export async function undeprecate(ext: Ext, actor: Actor, request?: Request) {
  await db.update(extensions).set({ deprecatedAt: null, deprecationMessage: null, replacementSlug: null }).where(eq(extensions.id, ext.id));
  await audit(actor, "extension.undeprecate", { kind: "extension", id: ext.id }, { slug: ext.slug }, request);
}

export async function setArchived(ext: Ext, archived: boolean, actor: Actor, request?: Request) {
  if (ext.status === "suspended") throw new HttpError(409, "A suspended extension can only be changed by staff", "suspended");
  if (archived && ext.status !== "approved") throw new HttpError(409, "Only a listed extension can be archived", "conflict");
  if (!archived && ext.status !== "archived") throw new HttpError(409, "The extension is not archived", "conflict");
  await db.update(extensions).set({ status: archived ? "archived" : "approved", updatedAt: new Date() }).where(eq(extensions.id, ext.id));
  await audit(actor, archived ? "extension.archive" : "extension.unarchive", { kind: "extension", id: ext.id }, { slug: ext.slug }, request);
}

export async function suspend(ext: Ext, reason: string, actor: Actor, request?: Request) {
  if (!reason.trim()) throw new HttpError(400, "Give a reason", "bad_request");
  await db.update(extensions).set({ status: "suspended", suspendedReason: reason, updatedAt: new Date() }).where(eq(extensions.id, ext.id));
  // Nothing of a suspended extension may still be published.
  await db.update(submissions).set({ status: "withdrawn", error: "Extension suspended" })
    .where(and(eq(submissions.extensionId, ext.id), inArray(submissions.status, ["queued", "awaiting_review", "publishing"])));
  await audit(actor, "extension.suspend", { kind: "extension", id: ext.id }, { slug: ext.slug, reason }, request);
}

export async function unsuspend(ext: Ext, actor: Actor, request?: Request) {
  const hasVersion = !!db.select({ id: extensionVersions.id }).from(extensionVersions).where(eq(extensionVersions.extensionId, ext.id)).get();
  await db.update(extensions).set({ status: hasVersion ? "approved" : "pending", suspendedReason: null, updatedAt: new Date() }).where(eq(extensions.id, ext.id));
  await audit(actor, "extension.unsuspend", { kind: "extension", id: ext.id }, { slug: ext.slug }, request);
}

export async function setFeatured(ext: Ext, featured: boolean, actor: Actor, request?: Request) {
  await db.update(extensions).set({ featured }).where(eq(extensions.id, ext.id));
  await audit(actor, featured ? "extension.feature" : "extension.unfeature", { kind: "extension", id: ext.id }, { slug: ext.slug }, request);
}

/** Where versions are built from. Takes effect with the next submission. */
export async function setSource(ext: Ext, s: { host: Ext["sourceHost"]; repo: string; subpath: string }, actor: Actor, request?: Request) {
  const info = await source(s.host).repoInfo(s.repo).catch(() => null);
  if (!info) throw new HttpError(400, `Repository ${s.repo} does not exist on ${s.host}`, "repo_not_found");
  if (!info.isPublic) throw new HttpError(400, `Repository ${s.repo} is not public`, "repo_private");
  await db.update(extensions).set({ sourceHost: s.host, githubRepo: info.fullName, sourceRepoId: info.id, subpath: s.subpath, updatedAt: new Date() }).where(eq(extensions.id, ext.id));
  await audit(actor, "extension.source", { kind: "extension", id: ext.id }, { slug: ext.slug, from: { host: ext.sourceHost, repo: ext.githubRepo, subpath: ext.subpath }, to: s }, request);
}

// ── text changes ─────────────────────────────────────────────────────────────

const TEXT_LIMITS: Record<TextField, number> = { description: 500, long_description: 20_000, changelog: 20_000, deprecation_message: 1_000, tags: 500 };

function currentText(ext: Ext, field: TextField, versionId: string | null): string | null {
  if (field === "changelog") return versionId ? db.select({ c: extensionVersions.changelog }).from(extensionVersions).where(eq(extensionVersions.id, versionId)).get()?.c ?? null : null;
  if (field === "tags") return JSON.stringify(ext.tags ?? []);
  return { description: ext.description, long_description: ext.longDescription, deprecation_message: ext.deprecationMessage }[field] ?? null;
}

/** Public text changes wait for a reviewer; the page keeps the approved text until then. */
export async function proposeTextChange(ext: Ext, field: TextField, value: string, versionId: string | null, actor: Actor, request?: Request) {
  if (!TEXT_FIELDS.includes(field)) throw new HttpError(400, "Unknown field", "bad_request");
  if (value.length > TEXT_LIMITS[field]) throw new HttpError(400, `${field} is longer than ${TEXT_LIMITS[field]} characters`, "bad_request");
  if (field === "description" && !value.trim()) throw new HttpError(400, "The description can't be empty", "bad_request");
  if (field === "tags") {
    let tags: unknown;
    try {
      tags = JSON.parse(value);
    } catch {
      tags = null;
    }
    if (!Array.isArray(tags) || tags.length > 8 || tags.some((t) => typeof t !== "string" || !/^[a-z0-9-]{2,32}$/.test(t))) throw new HttpError(400, "Tags are up to 8 lowercase words", "bad_request");
  }
  // A newer proposal replaces an older pending one for the same field.
  await db.update(textChanges).set({ status: "withdrawn" }).where(and(eq(textChanges.extensionId, ext.id), eq(textChanges.field, field), eq(textChanges.status, "pending"),
    versionId ? eq(textChanges.versionId, versionId) : eq(textChanges.field, field)));
  const [row] = await db.insert(textChanges).values({ extensionId: ext.id, versionId, field, oldValue: currentText(ext, field, versionId), newValue: value, proposedBy: actor.id ?? "unknown" }).returning();
  await audit(actor, "text_change.propose", { kind: "text_change", id: row.id }, { slug: ext.slug, field }, request);
  return row;
}

export async function decideTextChange(id: string, approve: boolean, reviewerId: string, notes: string | null, request?: Request) {
  const tc = db.select().from(textChanges).where(eq(textChanges.id, id)).get();
  if (!tc) throw new HttpError(404, "Change not found", "not_found");
  if (!approve && !notes?.trim()) throw new HttpError(400, "Say why, so the author can fix it", "notes_required");
  const res = db.update(textChanges).set({ status: approve ? "approved" : "rejected", reviewerId, reviewNotes: notes, reviewedAt: new Date() })
    .where(and(eq(textChanges.id, id), eq(textChanges.status, "pending"))).run();
  if (res.changes !== 1) throw new HttpError(409, "This change was already decided", "conflict");
  const ext = db.select().from(extensions).where(eq(extensions.id, tc.extensionId)).get()!;
  if (approve) {
    const v = tc.newValue;
    if (tc.field === "changelog" && tc.versionId) await db.update(extensionVersions).set({ changelog: v, changelogSource: "manual" }).where(eq(extensionVersions.id, tc.versionId));
    else if (tc.field === "tags") await db.update(extensions).set({ tags: JSON.parse(v ?? "[]") }).where(eq(extensions.id, ext.id));
    else if (tc.field === "description") await db.update(extensions).set({ description: v ?? ext.description, updatedAt: new Date() }).where(eq(extensions.id, ext.id));
    else if (tc.field === "long_description") await db.update(extensions).set({ longDescription: v, updatedAt: new Date() }).where(eq(extensions.id, ext.id));
    else if (tc.field === "deprecation_message") await db.update(extensions).set({ deprecationMessage: v }).where(eq(extensions.id, ext.id));
  }
  await audit({ kind: "admin", id: reviewerId }, approve ? "text_change.approve" : "text_change.reject", { kind: "text_change", id }, { slug: ext.slug, field: tc.field, notes }, request);
  await queueNotification(tc.proposedBy, approve ? "text_change.approved" : "text_change.rejected", { slug: ext.slug, field: tc.field.replace("_", " "), notes });
}

// ── members ──────────────────────────────────────────────────────────────────

export async function addMember(ext: Ext, githubLogin: string, role: "owner" | "maintainer", actor: Actor, request?: Request) {
  const a = db.select().from(authors).where(eq(authors.githubLogin, githubLogin)).get();
  if (!a) throw new HttpError(404, `${githubLogin} has not signed in to the directory yet`, "not_found");
  await db.insert(extensionMembers).values({ extensionId: ext.id, authorId: a.id, role, addedBy: actor.id ?? null })
    .onConflictDoUpdate({ target: [extensionMembers.extensionId, extensionMembers.authorId], set: { role } });
  await audit(actor, "member.add", { kind: "extension", id: ext.id }, { slug: ext.slug, login: githubLogin, role }, request);
}

export async function removeMember(ext: Ext, authorId: string, actor: Actor, request?: Request) {
  const owners = db.select().from(extensionMembers).where(and(eq(extensionMembers.extensionId, ext.id), eq(extensionMembers.role, "owner"))).all();
  if (owners.length === 1 && owners[0].authorId === authorId) throw new HttpError(409, "An extension needs an owner; add another owner first", "last_owner");
  await db.delete(extensionMembers).where(and(eq(extensionMembers.extensionId, ext.id), eq(extensionMembers.authorId, authorId)));
  if (ext.authorId === authorId) {
    const next = owners.find((o) => o.authorId !== authorId);
    if (next) await db.update(extensions).set({ authorId: next.authorId }).where(eq(extensions.id, ext.id));
  }
  await audit(actor, "member.remove", { kind: "extension", id: ext.id }, { slug: ext.slug, authorId }, request);
}

export function membersOf(extensionId: string) {
  return db.select({ authorId: extensionMembers.authorId, role: extensionMembers.role, login: authors.githubLogin, name: authors.displayName, avatarUrl: authors.avatarUrl })
    .from(extensionMembers).innerJoin(authors, eq(authors.id, extensionMembers.authorId)).where(eq(extensionMembers.extensionId, extensionId)).all();
}

// ── trusted publishers ───────────────────────────────────────────────────────

const WORKFLOW_RE = /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/;
const ENV_RE = /^[A-Za-z0-9._ -]{1,100}$/;

export async function addPublisher(ext: Ext, p: { repository: string; workflowPath: string; environment: string | null; subpath: string; allowedRefs: "tags" | "any" }, actor: Actor, request?: Request) {
  if (!WORKFLOW_RE.test(p.workflowPath)) throw new HttpError(400, "The workflow must be a file in .github/workflows/", "bad_request");
  if (p.environment && !ENV_RE.test(p.environment)) throw new HttpError(400, "Not a valid environment name", "bad_request");
  const info = await source("github.com").repoInfo(p.repository).catch(() => null);
  if (!info) throw new HttpError(400, `Repository ${p.repository} does not exist on GitHub`, "repo_not_found");
  if (!info.isPublic) throw new HttpError(400, `Repository ${p.repository} is not public`, "repo_private");
  const [row] = await db.insert(publishers).values({
    id: crypto.randomUUID(), extensionId: ext.id, repository: info.fullName, repositoryId: info.id, repositoryOwnerId: info.ownerId,
    workflowPath: p.workflowPath, environment: p.environment, subpath: p.subpath, allowedRefs: p.allowedRefs, createdBy: actor.id!,
  }).returning();
  await audit(actor, "publisher.add", { kind: "publisher", id: row.id }, { slug: ext.slug, repository: row.repository, workflow: row.workflowPath, environment: row.environment, subpath: row.subpath }, request);
  return row;
}

export async function removePublisher(ext: Ext, id: string, actor: Actor, request?: Request) {
  const res = db.delete(publishers).where(and(eq(publishers.id, id), eq(publishers.extensionId, ext.id))).run();
  if (res.changes !== 1) throw new HttpError(404, "Publisher not found", "not_found");
  await audit(actor, "publisher.remove", { kind: "publisher", id }, { slug: ext.slug }, request);
}

// ── accounts (staff) ─────────────────────────────────────────────────────────

export async function banAuthor(authorId: string, reason: string, actor: Actor, request?: Request) {
  if (!reason.trim()) throw new HttpError(400, "Give a reason", "bad_request");
  const a = db.select().from(authors).where(eq(authors.id, authorId)).get();
  if (!a) throw new HttpError(404, "Author not found", "not_found");
  if (a.role === "super_admin") throw new HttpError(409, "Remove the super admin role first", "conflict");
  await db.update(authors).set({ banned: true, bannedAt: new Date(), bannedReason: reason, bannedBy: actor.id ?? null, sessionEpoch: a.sessionEpoch + 1, updatedAt: new Date() }).where(eq(authors.id, authorId));
  // Open work stops; tokens die with the account.
  await db.update(submissions).set({ status: "withdrawn", error: "Author banned" }).where(and(eq(submissions.authorId, authorId), inArray(submissions.status, ["queued", "awaiting_review", "publishing"])));
  for (const t of db.select({ id: apiTokens.id, revokedAt: apiTokens.revokedAt }).from(apiTokens).where(eq(apiTokens.authorId, authorId)).all()) {
    if (!t.revokedAt) await revokeToken(t.id, actor, "ban", request);
  }
  await db.update(publishers).set({ disabledAt: new Date() }).where(eq(publishers.createdBy, authorId));
  await audit(actor, "author.ban", { kind: "author", id: authorId }, { login: a.githubLogin, reason }, request);
}

export async function unbanAuthor(authorId: string, actor: Actor, request?: Request) {
  await db.update(authors).set({ banned: false, bannedAt: null, bannedReason: null, bannedBy: null, updatedAt: new Date() }).where(eq(authors.id, authorId));
  await audit(actor, "author.unban", { kind: "author", id: authorId }, {}, request);
}

export async function setRole(authorId: string, role: Role, actor: Actor, request?: Request) {
  if (!ROLES.includes(role)) throw new HttpError(400, "Unknown role", "bad_request");
  if (actor.id === authorId) throw new HttpError(409, "Ask another super admin to change your own role", "conflict");
  const a = db.select().from(authors).where(eq(authors.id, authorId)).get();
  if (!a) throw new HttpError(404, "Author not found", "not_found");
  await db.update(authors).set({ role, sessionEpoch: a.sessionEpoch + 1 }).where(eq(authors.id, authorId));
  await audit(actor, "author.role", { kind: "author", id: authorId }, { login: a.githubLogin, from: a.role, to: role }, request);
}

export async function setVerified(authorId: string, verified: boolean, actor: Actor, request?: Request) {
  await db.update(authors).set({ verified }).where(eq(authors.id, authorId));
  await audit(actor, verified ? "author.verify" : "author.unverify", { kind: "author", id: authorId }, {}, request);
}
