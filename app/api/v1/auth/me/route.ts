import { getAuthorSession, getAdminSession } from "@/lib/auth";
import { jsonResponse, errorResponse } from "@/lib/utils";
import { getAuthorByGithubId } from "@/lib/db/queries";

export async function GET() {
  try {
    const authorSession = await getAuthorSession();
    const adminSession = await getAdminSession();

    const response: Record<string, unknown> = {};

    // Author info
    if (authorSession.authorId && authorSession.githubId) {
      const author = await getAuthorByGithubId(authorSession.githubId);
      if (author) {
        response.author = {
          id: author.id,
          githubLogin: author.githubLogin,
          displayName: author.displayName,
          avatarUrl: author.avatarUrl,
          email: author.email,
          bio: author.bio,
          website: author.website,
          verified: author.verified,
        };
      }
    }

    // Admin info
    if (adminSession.adminId) {
      response.admin = {
        id: adminSession.adminId,
        githubLogin: adminSession.githubLogin,
        role: adminSession.role,
      };
    }

    if (!response.author && !response.admin) {
      return errorResponse("Not authenticated", 401);
    }

    return jsonResponse(response);
  } catch (error) {
    console.error("Error fetching user:", error);
    return errorResponse("Internal server error", 500);
  }
}
