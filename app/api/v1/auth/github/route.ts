import { NextRequest } from "next/server";
import crypto from "crypto";
import { authorizeUrl, safeReturnTo } from "@/lib/auth/github-oauth";
import { getSession } from "@/lib/auth/session";

// Starts the GitHub sign-in. The path stays /api/v1/auth/github because the
// OAuth app's callback URL is registered under it.
export async function GET(request: NextRequest) {
  const state = crypto.randomBytes(16).toString("hex");
  const session = await getSession();
  session.oauthState = state;
  session.oauthReturnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  await session.save();
  return Response.redirect(authorizeUrl(state));
}
