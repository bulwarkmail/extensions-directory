import { NextRequest } from "next/server";
import { exchangeCodeForToken, getGitHubUser } from "@/lib/github";
import { getAuthorSession, getAdminSession } from "@/lib/auth";
import { getAuthorByGithubId, getAdminByGithubId } from "@/lib/db/queries";
import { db } from "@/lib/db/client";
import { authors } from "@/lib/db/schema";
import { errorResponse } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");

    if (!code || !state) {
      return errorResponse("Missing code or state", 400);
    }

    // Verify CSRF state
    const session = await getAuthorSession();
    const savedState = session.oauthState;
    const returnTo = (session.oauthReturnTo as string) || "/submit";

    if (state !== savedState) {
      return errorResponse("Invalid state parameter", 400);
    }

    // Exchange code for token
    const accessToken = await exchangeCodeForToken(code);
    const githubUser = await getGitHubUser(accessToken);

    // Find or create author
    let author = await getAuthorByGithubId(githubUser.id);

    if (!author) {
      const result = await db
        .insert(authors)
        .values({
          githubId: githubUser.id,
          githubLogin: githubUser.login,
          displayName: githubUser.name || githubUser.login,
          avatarUrl: githubUser.avatar_url,
          email: githubUser.email,
          bio: githubUser.bio,
          website: githubUser.blog,
        })
        .returning();
      author = result[0];
    }

    // Set author session
    session.authorId = author.id;
    session.githubId = author.githubId;
    session.githubLogin = author.githubLogin;
    session.avatarUrl = author.avatarUrl ?? undefined;
    delete session.oauthState;
    delete session.oauthReturnTo;
    await session.save();

    // Check if user is also a directory admin
    const admin = await getAdminByGithubId(githubUser.id);
    if (admin) {
      const adminSession = await getAdminSession();
      adminSession.adminId = admin.id;
      adminSession.githubId = admin.githubId;
      adminSession.githubLogin = admin.githubLogin;
      adminSession.role = admin.role;
      await adminSession.save();
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
    return Response.redirect(`${siteUrl}${returnTo}`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    return errorResponse("Authentication failed", 500);
  }
}
