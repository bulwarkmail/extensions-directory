import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface AuthorSession {
  authorId?: string;
  githubId?: number;
  githubLogin?: string;
  avatarUrl?: string;
  [key: string]: unknown;
}

export interface AdminSession {
  adminId?: string;
  githubId?: number;
  githubLogin?: string;
  role?: "reviewer" | "admin" | "super_admin";
  [key: string]: unknown;
}

const authorSessionOptions: SessionOptions = {
  password: process.env.AUTHOR_SESSION_SECRET || "complex_password_at_least_32_characters_long_for_dev",
  cookieName: "ext_author_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
  },
};

const adminSessionOptions: SessionOptions = {
  password: process.env.ADMIN_SESSION_SECRET || "complex_admin_password_at_least_32_chars_for_dev",
  cookieName: "ext_admin_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
  },
};

export async function getAuthorSession() {
  const cookieStore = await cookies();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getIronSession<AuthorSession>(cookieStore as any, authorSessionOptions);
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getIronSession<AdminSession>(cookieStore as any, adminSessionOptions);
}

export async function requireAuthorSession() {
  const session = await getAuthorSession();
  if (!session.authorId) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireAdminSession() {
  const session = await getAdminSession();
  if (!session.adminId) {
    throw new Error("Unauthorized");
  }
  return session;
}
