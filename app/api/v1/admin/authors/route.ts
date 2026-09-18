import { NextRequest } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { requireAdminSession } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { authors, extensions } from "@/lib/db/schema";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function GET() {
  try {
    await requireAdminSession();

    const rows = await db
      .select({
        id: authors.id,
        githubId: authors.githubId,
        githubLogin: authors.githubLogin,
        displayName: authors.displayName,
        avatarUrl: authors.avatarUrl,
        email: authors.email,
        bio: authors.bio,
        website: authors.website,
        verified: authors.verified,
        banned: authors.banned,
        createdAt: authors.createdAt,
        extensionCount: sql<number>`(
          select cast(count(*) as integer)
          from ${extensions}
          where ${extensions.authorId} = ${authors.id}
        )`,
      })
      .from(authors)
      .orderBy(desc(authors.createdAt));

    const list = rows.map((a) => ({
      ...a,
      verified: !!a.verified,
      banned: !!a.banned,
    }));

    return jsonResponse({ authors: list });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return errorResponse("Unauthorized", 401);
    }
    console.error("Error fetching authors:", error);
    return errorResponse("Internal server error", 500);
  }
}

// Ban / unban / verify an author.
// Accepts { authorId, action: "ban"|"unban"|"verify"|"unverify" } OR
// { authorId, banned: boolean, verified: boolean } for explicit values.
export async function PATCH(request: NextRequest) {
  try {
    await requireAdminSession();
    const body = await request.json().catch(() => ({}));
    const { authorId, action, banned, verified } = body as {
      authorId?: string;
      action?: string;
      banned?: boolean;
      verified?: boolean;
    };

    if (!authorId) {
      return errorResponse("authorId is required", 400);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (action === "ban") updates.banned = true;
    else if (action === "unban") updates.banned = false;
    else if (action === "verify") updates.verified = true;
    else if (action === "unverify") updates.verified = false;
    else if (action) {
      return errorResponse(`Unknown action "${action}"`, 400);
    }
    if (typeof banned === "boolean") updates.banned = banned;
    if (typeof verified === "boolean") updates.verified = verified;

    if (Object.keys(updates).length === 1) {
      return errorResponse(
        "Provide an 'action' or 'banned'/'verified' field",
        400
      );
    }

    const updated = await db
      .update(authors)
      .set(updates)
      .where(eq(authors.id, authorId))
      .returning({ id: authors.id });

    if (updated.length === 0) {
      return errorResponse("Author not found", 404);
    }

    return jsonResponse({ data: { success: true, id: updated[0].id } });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return errorResponse("Unauthorized", 401);
    }
    console.error("Error updating author:", error);
    return errorResponse("Internal server error", 500);
  }
}
