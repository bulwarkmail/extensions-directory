import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getExtensionBySlug } from "@/lib/db/queries";
import { db } from "@/lib/db/client";
import { extensions } from "@/lib/db/schema";
import { getAdminSession, getAuthorSession } from "@/lib/auth";
import { parseGitHubUrl, verifyRepoIsPublic } from "@/lib/github";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const extension = await getExtensionBySlug(slug);

    if (!extension) {
      return errorResponse("Extension not found", 404);
    }

    if (extension.status !== "approved") {
      return errorResponse("Extension not found", 404);
    }

    return jsonResponse({ data: extension });
  } catch (error) {
    console.error("Error fetching extension:", error);
    return errorResponse("Internal server error", 500);
  }
}

// PATCH /api/v1/extension/[slug]
// Update an extension's repo / subpath / description.
//
// Authorization:
//   • The owning author (matched via session.authorId === extension.authorId)
//   • OR any signed-in directory admin
//
// Body (all optional, but at least one must be present):
//   { githubRepo?: string, subpath?: string, description?: string,
//     longDescription?: string | null }
//
// `githubRepo` accepts either "owner/repo" or a full GitHub URL — we normalize
// to "owner/repo" before storing. The repo is verified to exist and be public.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const [authorSession, adminSession] = await Promise.all([
      getAuthorSession(),
      getAdminSession(),
    ]);

    if (!authorSession.authorId && !adminSession.adminId) {
      return errorResponse("Unauthorized", 401);
    }

    // Look up the extension by slug.
    const [ext] = await db
      .select({
        id: extensions.id,
        authorId: extensions.authorId,
      })
      .from(extensions)
      .where(eq(extensions.slug, slug))
      .limit(1);

    if (!ext) {
      return errorResponse("Extension not found", 404);
    }

    const isAdmin = !!adminSession.adminId;
    const isOwner =
      !!authorSession.authorId && authorSession.authorId === ext.authorId;

    if (!isAdmin && !isOwner) {
      return errorResponse("Forbidden — only the author or an admin can edit this extension", 403);
    }

    const body = (await request.json().catch(() => null)) as
      | {
          githubRepo?: unknown;
          subpath?: unknown;
          description?: unknown;
          longDescription?: unknown;
        }
      | null;

    if (!body) return errorResponse("Invalid JSON body", 400);

    const updates: Record<string, unknown> = {};

    if (typeof body.githubRepo === "string") {
      const raw = body.githubRepo.trim();
      if (!raw) {
        return errorResponse("githubRepo cannot be empty", 400);
      }
      // Accept either "owner/repo" or a full GitHub URL.
      let normalized: string | null = null;
      if (/^[^/\s]+\/[^/\s]+$/.test(raw)) {
        normalized = raw.replace(/\.git$/, "");
      } else {
        const parsed = parseGitHubUrl(raw);
        if (parsed) normalized = `${parsed.owner}/${parsed.repo}`;
      }
      if (!normalized) {
        return errorResponse(
          "githubRepo must be 'owner/repo' or a GitHub URL like https://github.com/owner/repo",
          400
        );
      }
      const isPublic = await verifyRepoIsPublic(normalized).catch(() => false);
      if (!isPublic) {
        return errorResponse(
          `Repository ${normalized} is not public or does not exist`,
          400
        );
      }
      updates.githubRepo = normalized;
    }

    if (typeof body.subpath === "string") {
      const trimmed = body.subpath.trim().replace(/^\/+|\/+$/g, "");
      // Reject path traversal / absolute-style segments
      if (trimmed.split("/").some((seg) => seg === "..")) {
        return errorResponse("subpath cannot contain '..' segments", 400);
      }
      updates.subpath = trimmed;
    }

    if (typeof body.description === "string") {
      const trimmed = body.description.trim();
      if (!trimmed) {
        return errorResponse("description cannot be empty", 400);
      }
      if (trimmed.length > 500) {
        return errorResponse("description must be 500 characters or fewer", 400);
      }
      updates.description = trimmed;
    }

    if (
      typeof body.longDescription === "string" ||
      body.longDescription === null
    ) {
      // Allow clearing with null; admins use this to fix bad HTML.
      updates.longDescription =
        body.longDescription == null ? null : body.longDescription;
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse(
        "Provide at least one of: githubRepo, subpath, description, longDescription",
        400
      );
    }

    updates.updatedAt = new Date();

    const updated = await db
      .update(extensions)
      .set(updates)
      .where(eq(extensions.id, ext.id))
      .returning({
        id: extensions.id,
        slug: extensions.slug,
        githubRepo: extensions.githubRepo,
        subpath: extensions.subpath,
        description: extensions.description,
      });

    return jsonResponse({ data: updated[0] });
  } catch (error) {
    console.error("Error updating extension:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
}
