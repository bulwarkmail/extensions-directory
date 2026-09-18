import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdminSession } from "@/lib/auth";
import { getPendingSubmissions } from "@/lib/db/queries";
import { db } from "@/lib/db/client";
import {
  submissions,
  extensions,
  extensionVersions,
} from "@/lib/db/schema";
import { jsonResponse, errorResponse } from "@/lib/utils";
import { trackServerEvent } from "@/lib/umami";
import { buildAndStoreBundle, validateManifest } from "@/lib/manifest";
import { extractAndStoreMedia } from "@/lib/media";
import { getRepoLicense } from "@/lib/github";

export async function GET() {
  try {
    await requireAdminSession();
    const rows = await getPendingSubmissions();

    const list = rows.map((row) => {
      const s = row.submissions;
      const a = row.authors;
      const e = row.extensions;
      const manifest = (s.manifestSnapshot ?? {}) as Record<string, unknown>;
      const extensionName =
        (typeof manifest.name === "string" && manifest.name) ||
        e?.name ||
        s.subpath ||
        s.githubRepo;
      const version =
        (typeof manifest.version === "string" && manifest.version) || "";
      const declaredType =
        (typeof manifest.type === "string" && manifest.type) || "";
      const scanReport = s.scanReport as
        | {
            findings?: { severity: string }[];
            fileCount?: number;
            jsFiles?: number;
            cssFiles?: number;
          }
        | null;
      const findings = scanReport?.findings ?? [];

      return {
        id: s.id,
        type: s.type,
        status: s.status,
        extensionName,
        version,
        declaredType,
        repoUrl: `https://github.com/${s.githubRepo}`,
        githubRepo: s.githubRepo,
        ref: s.githubTag,
        subpath: s.subpath ?? "",
        submittedAt: s.submittedAt,
        manifest: s.manifestSnapshot,
        scan: scanReport
          ? {
              fileCount: scanReport.fileCount ?? 0,
              jsFiles: scanReport.jsFiles ?? 0,
              cssFiles: scanReport.cssFiles ?? 0,
              warnings: findings.filter((f) => f.severity === "warn"),
              blockers: findings.filter((f) => f.severity === "block"),
            }
          : null,
        author: a
          ? {
              displayName: a.displayName,
              githubLogin: a.githubLogin,
              avatarUrl: a.avatarUrl,
            }
          : null,
      };
    });

    return jsonResponse({ submissions: list });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return errorResponse("Unauthorized", 401);
    }
    console.error("Error fetching submissions:", error);
    return errorResponse("Internal server error", 500);
  }
}

// Approve or reject a submission. On approve, the bundle is downloaded from
// GitHub at the recorded ref+subpath, stored locally, and the extension &
// version rows are created (or updated, for new_version submissions).
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminSession();
    const body = await request.json();
    const { submissionId, action, reviewNotes } = body;

    if (!submissionId || !["approve", "reject"].includes(action)) {
      return errorResponse("Invalid request", 400);
    }

    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);

    if (!submission) {
      return errorResponse("Submission not found", 404);
    }

    const now = new Date();

    if (action === "reject") {
      await db
        .update(submissions)
        .set({
          status: "rejected",
          reviewerId: session.adminId,
          reviewNotes,
          reviewedAt: now,
        })
        .where(eq(submissions.id, submissionId));

      if (submission.versionId) {
        await db
          .update(extensionVersions)
          .set({
            reviewStatus: "rejected",
            reviewerId: session.adminId,
            reviewNotes,
          })
          .where(eq(extensionVersions.id, submission.versionId));
      }

      if (submission.type === "new_extension" && submission.extensionId) {
        await db
          .update(extensions)
          .set({ status: "rejected" })
          .where(eq(extensions.id, submission.extensionId));
      }

      trackServerEvent(
        "extension-review",
        "/api/v1/admin/submissions",
        { action: "reject", submissionId },
        request,
      );
      return jsonResponse({ data: { success: true, action: "reject" } });
    }

    // ── action === "approve" ────────────────────────────────────────────────
    if (!submission.manifestSnapshot) {
      return errorResponse(
        "Submission has no manifest snapshot — was it created before manifest validation? Reject and resubmit.",
        400
      );
    }

    const validation = validateManifest(submission.manifestSnapshot);
    if (!validation.ok) {
      return errorResponse(
        `Manifest validation failed at approval time: ${validation.error}`,
        400
      );
    }
    const manifest = validation.manifest;

    let bundleInfo;
    try {
      bundleInfo = await buildAndStoreBundle(
        submission.githubRepo,
        submission.githubTag,
        submission.subpath,
        manifest
      );
    } catch (err) {
      return errorResponse(
        err instanceof Error
          ? `Bundle build failed: ${err.message}`
          : "Bundle build failed",
        500
      );
    }

    const license =
      (typeof manifest.raw.license === "string" && manifest.raw.license) ||
      (await getRepoLicense(submission.githubRepo).catch(() => null)) ||
      "MIT";

    // Find or create the extension row (by slug)
    let extensionId = submission.extensionId;
    if (!extensionId) {
      const [existingBySlug] = await db
        .select({ id: extensions.id })
        .from(extensions)
        .where(eq(extensions.slug, manifest.slug))
        .limit(1);
      extensionId = existingBySlug?.id ?? null;
    }

    if (!extensionId) {
      const [created] = await db
        .insert(extensions)
        .values({
          slug: manifest.slug,
          name: manifest.displayName,
          type: manifest.type,
          pluginType: manifest.pluginType,
          authorId: submission.authorId,
          description: manifest.description,
          githubRepo: submission.githubRepo,
          subpath: submission.subpath ?? "",
          license,
          status: "approved",
          permissions: manifest.permissions,
          tags: Array.isArray(manifest.raw.tags)
            ? (manifest.raw.tags as unknown[]).filter(
                (t): t is string => typeof t === "string"
              )
            : [],
          minAppVersion: manifest.minAppVersion,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: extensions.id });
      extensionId = created.id;
    } else {
      // Refresh the canonical repo/subpath from this submission — authors can
      // legitimately switch repos or move directories between releases.
      await db
        .update(extensions)
        .set({
          name: manifest.displayName,
          description: manifest.description,
          githubRepo: submission.githubRepo,
          subpath: submission.subpath ?? "",
          permissions: manifest.permissions,
          minAppVersion: manifest.minAppVersion,
          status: "approved",
          updatedAt: now,
        })
        .where(eq(extensions.id, extensionId));
    }

    // Carry the submission-time scan report onto the version record. If the
    // submission predates the scanner (no report stored), default to "pending"
    // so admins know it was never scanned.
    const scanReport = submission.scanReport as
      | { findings?: { severity: string }[] }
      | null;
    const hasWarnings = !!scanReport?.findings?.some(
      (f) => f.severity === "warn"
    );
    const scanStatus: "clean" | "flagged" | "pending" = scanReport
      ? hasWarnings
        ? "flagged"
        : "clean"
      : "pending";

    // Create the version row
    const [createdVersion] = await db
      .insert(extensionVersions)
      .values({
        extensionId,
        version: manifest.version,
        bundlePath: bundleInfo.path,
        bundleSha256: bundleInfo.sha256,
        bundleSize: bundleInfo.size,
        permissions: manifest.permissions,
        minAppVersion: manifest.minAppVersion,
        manifest: manifest.raw,
        scanStatus,
        scanReport: scanReport as Record<string, unknown> | null,
        reviewStatus: "approved",
        reviewerId: session.adminId,
        reviewNotes,
        publishedAt: now,
        createdAt: now,
      })
      .returning({ id: extensionVersions.id });

    // Pull marketplace media (icon, banner, screenshots) from the source repo.
    // These are NOT inside the runtime bundle — authors declare paths in the
    // manifest and we ingest them straight from git. Failures here become
    // warnings rather than aborting the approval.
    let mediaWarnings: string[] = [];
    try {
      const report = await extractAndStoreMedia(
        submission.githubRepo,
        submission.githubTag,
        submission.subpath,
        manifest,
        extensionId,
      );
      mediaWarnings = report.warnings;
    } catch (err) {
      mediaWarnings.push(
        err instanceof Error ? err.message : "Media extraction failed",
      );
    }

    await db
      .update(submissions)
      .set({
        status: "approved",
        extensionId,
        versionId: createdVersion.id,
        reviewerId: session.adminId,
        reviewNotes,
        reviewedAt: now,
      })
      .where(eq(submissions.id, submissionId));

    trackServerEvent(
      "extension-review",
      "/api/v1/admin/submissions",
      {
        action: "approve",
        submissionId,
        slug: manifest.slug,
        version: manifest.version,
      },
      request,
    );

    return jsonResponse({
      data: {
        success: true,
        action: "approve",
        extensionId,
        versionId: createdVersion.id,
        slug: manifest.slug,
        version: manifest.version,
        mediaWarnings,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return errorResponse("Unauthorized", 401);
    }
    console.error("Error processing submission:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
}
