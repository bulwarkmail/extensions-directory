import { NextRequest } from "next/server";
import { getGitHubAuthUrl } from "@/lib/github";
import { getAuthorSession } from "@/lib/auth";
import crypto from "crypto";

export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/submit";
  const state = crypto.randomBytes(16).toString("hex");

  // Store state in session for CSRF protection
  const session = await getAuthorSession();
  session.oauthState = state;
  session.oauthReturnTo = returnTo;
  await session.save();

  const authUrl = getGitHubAuthUrl(state);
  return Response.redirect(authUrl);
}
