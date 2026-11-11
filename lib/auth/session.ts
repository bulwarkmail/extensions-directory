// Browser sessions. One iron-session cookie (the existing author cookie, so
// people stay signed in across the rework) holding the author id and the
// session epoch. Every request loads the author row: a ban, a role change
// or a bumped epoch takes effect on the next request, not when the cookie
// expires.
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { Role } from "@/lib/db/schema";
import { isBanned, isOrg, loadAuthor } from "./guard";
import { ownSecret } from "./secrets";

export interface SessionData {
  authorId?: string;
  epoch?: number;
  oauthState?: string;
  oauthReturnTo?: string;
  [key: string]: unknown;
}

/**
 * The key that seals the session cookie: AUTHOR_SESSION_SECRET, checked on
 * every use (lib/auth/secrets.ts). Without a value that passes, no session is
 * opened or issued.
 */
export function sessionSecret(): string {
  return ownSecret("AUTHOR_SESSION_SECRET");
}

function options(): SessionOptions {
  return {
    password: sessionSecret(),
    cookieName: "ext_author_session",
    ttl: 14 * 24 * 3600,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
    },
  };
}

export async function getSession() {
  const store = await cookies();
  return getIronSession<SessionData>(store as never, options());
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

/** The signed-in author, or null. Banned or outdated sessions, and organizations, count as signed out. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session.authorId) return null;
  const author = await loadAuthor(session.authorId);
  if (!author || isBanned(author) || isOrg(author) || (session.epoch ?? 0) !== author.sessionEpoch) return null;
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

/** The origin of an http(s) URL, or null for anything else. */
function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The origin the browser sent the request to. Behind nginx, request.url
 * carries the address Next listens on, so the host comes from the Host header
 * nginx passes on; the scheme is the one Next took from the connection or
 * X-Forwarded-Proto.
 */
function requestOrigin(request: Request): string | null {
  const url = new URL(request.url);
  return originOf(`${url.protocol}//${request.headers.get("host") ?? url.host}`);
}

/**
 * State-changing requests made with the cookie must come from our own pages.
 * SameSite=Lax already stops most cross-site posts; this closes the rest.
 * The Origin header has to be NEXT_PUBLIC_SITE_URL's origin, or the
 * request's own origin when that is unset. A write without an Origin, or a
 * site URL that is no URL, is refused.
 */
export function assertSameOrigin(request: Request): void {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const expected = site ? originOf(site) : requestOrigin(request);
  const origin = originOf(request.headers.get("origin"));
  if (!expected || !origin || origin !== expected) throw new HttpError(403, "Cross-site request refused", "bad_origin");
}
