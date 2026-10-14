import { NextRequest } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authors } from "@/lib/db/schema";
import { exchangeCode, fetchProfile, safeReturnTo } from "@/lib/auth/github-oauth";
import { getSession } from "@/lib/auth/session";
import { isBanned } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { errorResponse } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const session = await getSession();
    const expected = session.oauthState;
    if (!code || !state || !expected || state.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
      return errorResponse("Sign-in expired or was started elsewhere. Try again.", 400);
    }
    const returnTo = safeReturnTo(session.oauthReturnTo);
    delete session.oauthState;
    delete session.oauthReturnTo;

    const profile = await fetchProfile(await exchangeCode(code));
    const now = new Date();
    let author = db.select().from(authors).where(eq(authors.githubId, profile.id)).get();
    if (!author) {
      author = db.insert(authors).values({
        githubId: profile.id, githubLogin: profile.login, displayName: profile.name || profile.login, avatarUrl: profile.avatarUrl,
        email: profile.email, bio: profile.bio, website: profile.blog, createdAt: now, updatedAt: now,
      }).returning().get();
      await audit({ kind: "author", id: author.id }, "author.sign_up", { kind: "author", id: author.id }, { login: profile.login }, request);
    } else {
      // GitHub logins can be renamed; keep the profile current.
      db.update(authors).set({ githubLogin: profile.login, displayName: profile.name || profile.login, avatarUrl: profile.avatarUrl, email: profile.email ?? author.email, updatedAt: now })
        .where(eq(authors.id, author.id)).run();
    }
    if (isBanned(author)) {
      session.destroy();
      return Response.redirect(`${site}/banned`);
    }
    session.authorId = author.id;
    session.epoch = author.sessionEpoch;
    await session.save();
    return Response.redirect(`${site}${returnTo}`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    return errorResponse("Authentication failed", 500);
  }
}
