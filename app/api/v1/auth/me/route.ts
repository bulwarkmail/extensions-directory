import { currentUser, hasRole } from "@/lib/auth/session";
import { jsonResponse, errorResponse } from "@/lib/utils";

// Kept for older pages; /api/v2/me is the current endpoint.
export async function GET() {
  const user = await currentUser();
  if (!user) return errorResponse("Not authenticated", 401);
  return jsonResponse({
    author: { id: user.id, githubLogin: user.githubLogin, displayName: user.displayName, avatarUrl: user.avatarUrl, bio: user.bio, website: user.website, verified: user.verified },
    ...(hasRole(user.role, "reviewer") ? { admin: { id: user.id, githubLogin: user.githubLogin, role: user.role } } : {}),
  });
}
