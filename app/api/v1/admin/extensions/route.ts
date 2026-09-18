import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAdminSession } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { extensions, authors } from "@/lib/db/schema";
import { parseGitHubUrl, verifyRepoIsPublic } from "@/lib/github";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function GET() {
  try {
    await requireAdminSession();

    const rows = await db
      .select()
      .from(extensions)
      .leftJoin(authors, eq(extensions.authorId, authors.id))
      .orderBy(desc(extensions.updatedAt));

    const list = rows.map((row) => {
      const e = row.extensions;
      const a = row.authors;
      return {
        id: e.id,
        slug: e.slug,
        name: e.name,
        type: e.type,
        pluginType: e.pluginType,
        description: e.description,
        githubRepo: e.githubRepo,
        subpath: e.subpath ?? "",
        license: e.license,
        status: e.status,
        featured: !!e.featured,
        permissions: e.permissions ?? [],
        tags: e.tags ?? [],
        totalDownloads: e.totalDownloads ?? 0,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        author: a
          ? {
              id: a.id,
              displayName: a.displayName,
              githubLogin: a.githubLogin,
              avatarUrl: a.avatarUrl,
              verified: !!a.verified,
              banned: !!a.banned,
            }
          : null,
      };
    });

    return jsonResponse({ extensions: list });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return errorResponse("Unauthorized", 401);
    }
    console.error("Error fetching extensions:", error);
    return errorResponse("Internal server error", 500);
  }
}

// Update an extension's status / featured flag / repo / subpath / description.
// Accepts either { extensionId } or { slug } as the target.
export async function PATCH(request: NextRequest) {
  try {
    await requireAdminSession();
    const body = await request.json().catch(() => ({}));
    const {
      extensionId,
      slug,
      featured,
      status,
      githubRepo,
      subpath,
      description,
    } = body as {
      extensionId?: string;
      slug?: string;
      featured?: boolean;
      status?: string;
      githubRepo?: string;
      subpath?: string;
      description?: string;
    };

    if (!extensionId && !slug) {
      return errorResponse("extensionId or slug is required", 400);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof featured === "boolean") updates.featured = featured;
    if (typeof status === "string") {
      const allowed = ["pending", "approved", "rejected", "suspended", "archived"];
      if (!allowed.includes(status)) {
        return errorResponse(`Invalid status "${status}"`, 400);
      }
      updates.status = status;
    }
    if (typeof githubRepo === "string") {
      const raw = githubRepo.trim();
      if (!raw) {
        return errorResponse("githubRepo cannot be empty", 400);
      }
      let normalized: string | null = null;
      if (/^[^/\s]+\/[^/\s]+$/.test(raw)) {
        normalized = raw.replace(/\.git$/, "");
      } else {
        const parsed = parseGitHubUrl(raw);
        if (parsed) normalized = `${parsed.owner}/${parsed.repo}`;
      }
      if (!normalized) {
        return errorResponse(
          "githubRepo must be 'owner/repo' or a GitHub URL",
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
    if (typeof subpath === "string") {
      const trimmed = subpath.trim().replace(/^\/+|\/+$/g, "");
      if (trimmed.split("/").some((seg) => seg === "..")) {
        return errorResponse("subpath cannot contain '..' segments", 400);
      }
      updates.subpath = trimmed;
    }
    if (typeof description === "string") {
      const trimmed = description.trim();
      if (!trimmed) return errorResponse("description cannot be empty", 400);
      if (trimmed.length > 500) {
        return errorResponse("description must be 500 characters or fewer", 400);
      }
      updates.description = trimmed;
    }

    if (Object.keys(updates).length === 1) {
      return errorResponse(
        "Provide at least one of 'featured', 'status', 'githubRepo', 'subpath', 'description' to update",
        400
      );
    }

    const where = extensionId
      ? eq(extensions.id, extensionId)
      : eq(extensions.slug, slug!);

    const updated = await db
      .update(extensions)
      .set(updates)
      .where(where)
      .returning({ id: extensions.id });

    if (updated.length === 0) {
      return errorResponse("Extension not found", 404);
    }

    return jsonResponse({ data: { success: true, id: updated[0].id } });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return errorResponse("Unauthorized", 401);
    }
    console.error("Error updating extension:", error);
    return errorResponse("Internal server error", 500);
  }
}
