// Organization authors: a GitHub organization that owns extensions. It never
// signs in; its members manage everything it owns (lib/auth/guard.ts,
// memberRole). Only staff create organizations (by migration for now).
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { authors, extensionMembers, extensions, orgMembers, type OrgRole } from "./db/schema";
import { HttpError, hasRole, type SessionUser } from "./auth/session";
import { isBanned, type MemberRole } from "./auth/guard";
import { audit, type Actor } from "./audit";

type Author = typeof authors.$inferSelect;
type Ext = typeof extensions.$inferSelect;

export function orgOr404(login: string): Author {
  const org = db.select().from(authors).where(and(eq(authors.githubLogin, login), eq(authors.kind, "org"))).get();
  if (!org) throw new HttpError(404, "Organization not found", "not_found");
  return org;
}

export function orgRole(userId: string, orgId: string): OrgRole | null {
  return db.select({ role: orgMembers.role }).from(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.authorId, userId))).get()?.role ?? null;
}

/** Organizations the user belongs to. */
export function orgsOf(userId: string) {
  return db.select({ id: authors.id, login: authors.githubLogin, name: authors.displayName, avatarUrl: authors.avatarUrl, role: orgMembers.role })
    .from(orgMembers).innerJoin(authors, eq(authors.id, orgMembers.orgId)).where(eq(orgMembers.authorId, userId)).all();
}

export function orgMembersOf(orgId: string) {
  return db.select({ authorId: orgMembers.authorId, role: orgMembers.role, login: authors.githubLogin, name: authors.displayName, avatarUrl: authors.avatarUrl })
    .from(orgMembers).innerJoin(authors, eq(authors.id, orgMembers.authorId)).where(eq(orgMembers.orgId, orgId)).all();
}

/** Org owners and directory admins manage an organization's members. */
export function assertOrgManager(user: SessionUser, org: Author): void {
  if (!hasRole(user.role, "admin") && orgRole(user.id, org.id) !== "owner") throw new HttpError(403, "Only an owner of the organization can do this", "forbidden");
}

export async function addOrgMember(org: Author, login: string, role: OrgRole, actor: Actor, request?: Request) {
  if (role !== "owner" && role !== "member") throw new HttpError(400, "role must be owner or member", "bad_request");
  const a = db.select().from(authors).where(and(eq(authors.githubLogin, login), eq(authors.kind, "user"))).get();
  if (!a) throw new HttpError(404, `${login} has not signed in to the directory yet`, "not_found");
  if (isBanned(a)) throw new HttpError(409, `${login} is banned`, "conflict");
  await db.insert(orgMembers).values({ orgId: org.id, authorId: a.id, role, addedBy: actor.id ?? null })
    .onConflictDoUpdate({ target: [orgMembers.orgId, orgMembers.authorId], set: { role } });
  await audit(actor, "org.member.add", { kind: "author", id: org.id }, { org: org.githubLogin, login, role }, request);
}

export async function removeOrgMember(org: Author, authorId: string, actor: Actor, request?: Request) {
  const owners = db.select().from(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.role, "owner"))).all();
  if (owners.length === 1 && owners[0].authorId === authorId) throw new HttpError(409, "An organization needs an owner; add another owner first", "last_owner");
  const res = db.delete(orgMembers).where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.authorId, authorId))).run();
  if (res.changes !== 1) throw new HttpError(404, "Not a member", "not_found");
  await audit(actor, "org.member.remove", { kind: "author", id: org.id }, { org: org.githubLogin, authorId }, request);
}

/**
 * Who owns a new reservation: the user, or an organization they belong to
 * when `owner` names one.
 */
export function reservationOwner(user: SessionUser, owner: string | undefined): Author | SessionUser {
  if (!owner || owner === user.githubLogin) return user;
  const org = db.select().from(authors).where(and(eq(authors.githubLogin, owner), eq(authors.kind, "org"))).get();
  if (!org || !orgRole(user.id, org.id)) throw new HttpError(403, `You are not a member of the organization ${owner}`, "forbidden");
  return org;
}

/**
 * Every extension the user manages, through extension_members or through an
 * organization, with the higher role and the organization's login if the
 * access comes (also) from one.
 */
export function extensionsManagedBy(userId: string): { e: Ext; role: MemberRole; org: string | null }[] {
  const direct = db.select({ e: extensions, role: extensionMembers.role }).from(extensionMembers)
    .innerJoin(extensions, eq(extensions.id, extensionMembers.extensionId)).where(eq(extensionMembers.authorId, userId)).all();
  const orgs = orgsOf(userId);
  const viaOrg = orgs.length ? db.select().from(extensions).where(inArray(extensions.authorId, orgs.map((o) => o.id))).all() : [];
  const out = new Map<string, { e: Ext; role: MemberRole; org: string | null }>();
  for (const { e, role } of direct) out.set(e.id, { e, role, org: null });
  for (const e of viaOrg) {
    const o = orgs.find((x) => x.id === e.authorId)!;
    const role: MemberRole = o.role === "owner" ? "owner" : "maintainer";
    const prev = out.get(e.id);
    out.set(e.id, { e, role: prev?.role === "owner" ? "owner" : role, org: o.login });
  }
  return [...out.values()].sort((a, b) => (b.e.updatedAt?.getTime() ?? 0) - (a.e.updatedAt?.getTime() ?? 0));
}

/** Everyone who maintains the extension, directly or through its organization. */
export function maintainerIds(ext: Pick<Ext, "id" | "authorId">): string[] {
  const ids = db.select({ id: extensionMembers.authorId }).from(extensionMembers).where(eq(extensionMembers.extensionId, ext.id)).all().map((r) => r.id);
  for (const m of db.select({ id: orgMembers.authorId }).from(orgMembers).where(eq(orgMembers.orgId, ext.authorId)).all()) ids.push(m.id);
  return [...new Set(ids)];
}
