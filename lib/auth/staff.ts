// The role check for staff pages and staff data. Every page under app/admin
// calls staffPage() before it reads anything, and every staff reader in
// lib/dashboard.ts calls requireStaff() again, so a page that forgets its own
// check still gets nothing. The admin layout's check only decides whether the
// navigation or the sign-in prompt is shown: Next renders a page and sends
// what it returned whatever its layout does.
import { notFound } from "next/navigation";
import { HttpError, currentUser, hasRole, type SessionUser } from "./session";

/** Reviewers see the review work; admins also see accounts, API tokens and the audit log. */
export type StaffRole = "reviewer" | "admin";

/** The signed-in account if it holds `role` or a higher one. Banned or outdated sessions count as signed out. */
export async function staffUser(role: StaffRole): Promise<SessionUser | null> {
  const user = await currentUser();
  return user && hasRole(user.role, role) ? user : null;
}

/** For staff data readers: the account, or a 403 HttpError. */
export async function requireStaff(role: StaffRole): Promise<SessionUser> {
  const user = await staffUser(role);
  if (!user) throw new HttpError(403, "Not allowed", "forbidden");
  return user;
}

/**
 * For admin pages: the account, or Next's not-found answer, the same for a
 * visitor and for an account without the role. The admin layout shows the
 * sign-in prompt in the page's place when nobody from staff is signed in.
 */
export async function staffPage(role: StaffRole): Promise<SessionUser> {
  const user = await staffUser(role);
  if (!user) notFound();
  return user;
}
