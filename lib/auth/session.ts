// Browser sessions. One iron-session cookie (the existing author cookie, so
// people stay signed in across the rework) holding the author id and the
// session epoch. Every request loads the author row: a ban, a role change
// or a bumped epoch takes effect on the next request, not when the cookie
// expires.
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { Role } from "@/lib/db/schema";
import { isBanned, loadAuthor } from "./guard";

export interface SessionData {
  authorId?: string;
  epoch?: number;
  oauthState?: string;
  oauthReturnTo?: string;
  [key: string]: unknown;
}

const options: SessionOptions = {
  password: process.env.AUTHOR_SESSION_SECRET || "complex_password_at_least_32_characters_long_for_dev",
  cookieName: "ext_author_session",
  ttl: 14 * 24 * 3600,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
  },
};

export async function getSession() {
  const store = await cookies();
  return getIronSession<SessionData>(store as never, options);
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = "error") {
    super(message);
  }
}

const RANK: Record<Role, number> = { author: 0, reviewer: 1, admin: 2, super_admin: 3 };

export function hasRole(role: Role, needed: Role): boolean {
  return RANK[role] >= RANK[needed];
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof loadAuthor>>>;

/** The signed-in author, or null. Banned or outdated sessions count as signed out. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session.authorId) return null;
  const author = await loadAuthor(session.authorId);
  if (!author || isBanned(author) || (session.epoch ?? 0) !== author.sessionEpoch) return null;
  return author;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in first", "unauthorized");
  return user;
}

export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user.role, role)) throw new HttpError(403, "Not allowed", "forbidden");
  return user;
}

/**
 * State-changing requests made with the cookie must come from our own pages.
 * SameSite=Lax already stops most cross-site posts; this closes the rest.
 */
export function assertSameOrigin(request: Request): void {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const origin = request.headers.get("origin");
  if (!site) return;
  if (!origin || origin !== new URL(site).origin) throw new HttpError(403, "Cross-site request refused", "bad_origin");
}
