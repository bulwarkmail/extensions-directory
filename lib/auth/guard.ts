// One place that decides whether an author may act on an extension. Called
// by every way in (browser session, API token, OIDC publish), again by the
// worker before it builds, and by approval before it publishes.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authors, extensionMembers, extensions, orgMembers } from "@/lib/db/schema";

export class Forbidden extends Error {
  readonly status = 403;
}

export type MemberRole = "owner" | "maintainer";

export async function loadAuthor(authorId: string) {
  const [a] = await db.select().from(authors).where(eq(authors.id, authorId)).limit(1);
  return a ?? null;
}

export function isBanned(a: { banned: boolean | null; bannedAt: Date | null } | null): boolean {
  return !a || !!a.banned || !!a.bannedAt;
}

/** An organization owns extensions but never acts itself; its members do. */
export function isOrg(a: { kind: string } | null | undefined): boolean {
  return a?.kind === "org";
}

/**
 * The author's role on the extension: from extension_members, or from
 * membership of the organization that owns it (org owner = owner, org
 * member = maintainer). The higher of the two wins.
 */
export async function memberRole(authorId: string, extensionId: string): Promise<MemberRole | null> {
  const [m] = await db
    .select({ role: extensionMembers.role })
    .from(extensionMembers)
    .where(and(eq(extensionMembers.authorId, authorId), eq(extensionMembers.extensionId, extensionId)))
    .limit(1);
  if (m?.role === "owner") return "owner";
  const [o] = await db
    .select({ role: orgMembers.role })
    .from(extensions)
    .innerJoin(orgMembers, and(eq(orgMembers.orgId, extensions.authorId), eq(orgMembers.authorId, authorId)))
    .where(eq(extensions.id, extensionId))
    .limit(1);
  if (o?.role === "owner") return "owner";
  return m?.role ?? (o ? "maintainer" : null);
}

/**
 * The author exists and isn't banned; with an extension, the author is a
 * member (an owner, when `owner` is set) and the extension isn't suspended.
 */
export async function assertActorAllowed(authorId: string, extensionId?: string | null, opts: { owner?: boolean } = {}): Promise<void> {
  const author = await loadAuthor(authorId);
  if (isBanned(author)) throw new Forbidden("This account can't publish extensions");
  if (isOrg(author)) throw new Forbidden("An organization can't act itself; its members do");
  if (!extensionId) return;
  const [ext] = await db.select({ status: extensions.status }).from(extensions).where(eq(extensions.id, extensionId)).limit(1);
  if (!ext) throw new Forbidden("Extension not found");
  if (ext.status === "suspended") throw new Forbidden("This extension is suspended");
  const role = await memberRole(authorId, extensionId);
  if (!role) throw new Forbidden("You are not a maintainer of this extension");
  if (opts.owner && role !== "owner") throw new Forbidden("Only an owner can do this");
}
