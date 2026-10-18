import { NextRequest } from "next/server";
import crypto from "crypto";
import { exchangeCode, fetchProfile, safeReturnTo } from "@/lib/auth/github-oauth";
import { getSession, HttpError } from "@/lib/auth/session";
import { isBanned } from "@/lib/auth/guard";
import { authorForSignIn } from "@/lib/auth/sign-in";
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
    let author;
    try {
      author = await authorForSignIn(profile, request);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.message, err.status);
      throw err;
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
