// The author row for a GitHub sign-in: found by the GitHub account id,
// created on first sign-in, profile refreshed on later ones. Organization
// rows are never matched, so nobody gets a session as an organization.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authors } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import type { GitHubProfile } from "./github-oauth";
import { HttpError } from "./session";

export async function authorForSignIn(profile: GitHubProfile, request?: Request) {
  const now = new Date();
  const taken = db.select({ id: authors.id }).from(authors).where(and(eq(authors.githubId, profile.id), eq(authors.kind, "org"))).get();
  if (taken) throw new HttpError(403, "This GitHub account is an organization in the directory and can't sign in", "org_sign_in");
  const author = db.select().from(authors).where(and(eq(authors.githubId, profile.id), eq(authors.kind, "user"))).get();
  if (!author) {
    const created = db.insert(authors).values({
      githubId: profile.id, githubLogin: profile.login, displayName: profile.name || profile.login, avatarUrl: profile.avatarUrl,
      email: profile.email, bio: profile.bio, website: profile.blog, createdAt: now, updatedAt: now,
    }).returning().get();
    await audit({ kind: "author", id: created.id }, "author.sign_up", { kind: "author", id: created.id }, { login: profile.login }, request);
    return created;
  }
  // GitHub logins can be renamed; keep the profile current.
  db.update(authors).set({ githubLogin: profile.login, displayName: profile.name || profile.login, avatarUrl: profile.avatarUrl, email: profile.email ?? author.email, updatedAt: now })
    .where(eq(authors.id, author.id)).run();
  return author;
}
