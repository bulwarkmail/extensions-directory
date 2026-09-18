import { NextRequest } from "next/server";
import JSZip from "jszip";
import { and, eq, or, sql } from "drizzle-orm";
import { requireAuthorSession } from "@/lib/auth";
import {
  parseGitHubUrl,
  verifyRepoIsPublic,
  getDefaultBranch,
  downloadRefArchive,
  resolveRefSha,
  statRepoPath,
} from "@/lib/github";
import { fetchManifest, resolveBundle, validateManifest } from "@/lib/manifest";
import { scanBundle } from "@/lib/scanner";
import { db } from "@/lib/db/client";
import { submissions, extensions } from "@/lib/db/schema";
import { jsonResponse, errorResponse } from "@/lib/utils";
import { trackServerEvent } from "@/lib/umami";

// POST /api/v1/submissions
// Create a new extension submission.
// Auth: author session.
// Body: {
//   repoUrl:  string  // https://github.com/owner/repo  OR  /tree/<ref>/<subpath>
//   ref?:     string  // branch / tag / commit (defaults to repo's default branch)
//   tag?:     string  // back-compat alias for ref
//   subpath?: string  // subdirectory inside the repo (for monorepos)
// }
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuthorSession();
    const authorId = session.authorId!;

    const body = (await request.json().catch(() => null)) as
      | {
          repoUrl?: unknown;
          ref?: unknown;
          tag?: unknown;
          subpath?: unknown;
        }
      | null;

    const repoUrl =
      body && typeof body.repoUrl === "string" ? body.repoUrl.trim() : "";
    const explicitRef =
      body && typeof body.ref === "string" && body.ref.trim()
        ? body.ref.trim()
        : body && typeof body.tag === "string" && body.tag.trim()
          ? body.tag.trim()
          : "";
    const explicitSubpath =
      body && typeof body.subpath === "string" ? body.subpath.trim() : "";

    if (!repoUrl) {
      return errorResponse("repoUrl is required", 400);
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return errorResponse(
        "repoUrl must be a GitHub URL (https://github.com/owner/repo or /tree/<ref>/<subpath>)",
        400
      );
    }

    const repo = `${parsed.owner}/${parsed.repo}`;

    const isPublic = await verifyRepoIsPublic(repo);
    if (!isPublic) {
      return errorResponse(
        `Repository ${repo} is not public or does not exist`,
        400
      );
    }

    // Resolve ref: explicit body > URL ref > default branch
    let ref = explicitRef || parsed.ref || "";
    let usedDefaultBranch = false;
    if (!ref) {
      try {
        ref = await getDefaultBranch(repo);
        usedDefaultBranch = true;
      } catch (err) {
        return errorResponse(
          err instanceof Error ? err.message : "Could not resolve default branch",
          400
        );
      }
    }

    // Resolve the ref to its current commit SHA. Pinning downstream fetches
    // to the SHA bypasses the raw.githubusercontent.com CDN cache (which
    // serves moving refs like "main" with ~5 min TTL) and keeps the manifest
    // and the bundle archive aligned to the same commit.
    const commitSha = await resolveRefSha(repo, ref).catch(() => null);
    if (!commitSha) {
      return errorResponse(
        `Ref "${ref}" does not exist in ${repo}. Use a real tag, branch name, or commit SHA — or leave the field blank to use the default branch.`,
        400
      );
    }

    // Resolve subpath: body > URL > ""
    const subpath = (explicitSubpath || parsed.subpath || "").replace(
      /^\/+|\/+$/g,
      ""
    );

    // Verify the subpath exists and is a directory before trying to read its
    // manifest — gives the submitter a precise error instead of a generic
    // "manifest not found". Use the resolved SHA so we look at the same
    // commit we'll later download.
    if (subpath) {
      const stat = await statRepoPath(repo, commitSha, subpath).catch(
        () => null
      );
      if (stat === null) {
        return errorResponse(
          `Directory "${subpath}/" does not exist in ${repo}@${ref}`,
          404
        );
      }
      if (stat === "file") {
        return errorResponse(
          `"${subpath}" is a file, not a directory. Set subpath to the directory containing manifest.json.`,
          400
        );
      }
    }

    // Fetch and validate manifest at the resolved commit SHA — never the
    // moving ref directly, since raw.githubusercontent.com caches branches.
    let manifestRaw: Record<string, unknown> | null;
    try {
      manifestRaw = await fetchManifest(repo, commitSha, subpath);
    } catch (err) {
      return errorResponse(
        err instanceof Error ? err.message : "Failed to fetch manifest",
        400
      );
    }
    if (!manifestRaw) {
      const where = subpath ? `${subpath}/` : "the repository root";
      const refLabel = usedDefaultBranch ? `${ref} (default branch)` : ref;
      return errorResponse(
        subpath
          ? `No manifest.json at ${where} in ${repo}@${refLabel}. If the plugin lives elsewhere, set the right subpath.`
          : `No manifest.json at ${where} of ${repo}@${refLabel}. If this is a monorepo, set "subpath" to the plugin directory (e.g. "jitsi-meet").`,
        404
      );
    }

    const validation = validateManifest(manifestRaw);
    if (!validation.ok) {
      return errorResponse(`Manifest validation failed: ${validation.error}`, 400);
    }
    const manifest = validation.manifest;

    // Look up existing extension by slug from manifest (more reliable than repo
    // for monorepos where one repo hosts many slugs).
    const [existingExt] = await db
      .select({ id: extensions.id, type: extensions.type })
      .from(extensions)
      .where(eq(extensions.slug, manifest.slug))
      .limit(1);

    // Cross-check: if the slug exists, type must match the new manifest's type
    if (existingExt && existingExt.type !== manifest.type) {
      return errorResponse(
        `Slug "${manifest.slug}" already exists as a ${existingExt.type}; cannot submit it as a ${manifest.type}`,
        409
      );
    }

    // Dedupe by what's actually in the bundle, not by the ref string. Moving
    // refs like "main" advance over time, so the same ref + new commit is a
    // legitimate resubmit — the manifest version is the real key.
    if (existingExt) {
      const dup = await db
        .select({ id: submissions.id, status: submissions.status })
        .from(submissions)
        .where(
          and(
            eq(submissions.extensionId, existingExt.id),
            sql`json_extract(${submissions.manifestSnapshot}, '$.version') = ${manifest.version}`
          )
        )
        .limit(1);
      if (dup.length > 0) {
        return errorResponse(
          `Version ${manifest.version} of "${manifest.slug}" has already been submitted (status: ${dup[0].status}). Bump the version field in manifest.json before resubmitting.`,
          409
        );
      }
    } else {
      // New extension: don't block re-submits across versions, but do block
      // when an earlier submission for the same repo+subpath is still in the
      // review queue (avoids duplicate "first time" submissions).
      const dup = await db
        .select({ id: submissions.id, status: submissions.status })
        .from(submissions)
        .where(
          and(
            eq(submissions.authorId, authorId),
            eq(submissions.githubRepo, repo),
            eq(submissions.subpath, subpath),
            or(
              eq(submissions.status, "pending"),
              eq(submissions.status, "scanning"),
              eq(submissions.status, "review")
            )
          )
        )
        .limit(1);
      if (dup.length > 0) {
        return errorResponse(
          `You already have a submission for this repo in the review queue (status: ${dup[0].status}). Wait for it to be reviewed before submitting again.`,
          409
        );
      }
    }

    // Download the repo, resolve which files actually make up the bundle, and
    // scan that resolved set for malicious / disallowed code.
    let scanReport;
    let bundleSource: string;
    try {
      const zipBuf = await downloadRefArchive(repo, commitSha);
      const zip = await JSZip.loadAsync(zipBuf);
      const allEntries = Object.keys(zip.files);
      const topDirs = new Set(
        allEntries.map((e) => e.split("/")[0]).filter(Boolean)
      );
      if (topDirs.size !== 1) {
        return errorResponse("Unexpected zipball structure", 500);
      }
      const topDir = [...topDirs][0] + "/";
      const prefix = subpath ? `${topDir}${subpath}/` : topDir;
      const resolved = await resolveBundle(zip, prefix, manifest);
      bundleSource = resolved.source;
      scanReport = await scanBundle(resolved, manifest);
    } catch (err) {
      return errorResponse(
        err instanceof Error ? err.message : "Failed to build bundle",
        400
      );
    }

    if (scanReport.blocked) {
      const blockingFindings = scanReport.findings.filter(
        (f) => f.severity === "block"
      );
      return jsonResponse(
        {
          error: "Submission rejected by code scan",
          findings: blockingFindings,
          summary: {
            fileCount: scanReport.fileCount,
            jsFiles: scanReport.jsFiles,
            cssFiles: scanReport.cssFiles,
            blockedCount: blockingFindings.length,
            warnCount: scanReport.findings.filter((f) => f.severity === "warn")
              .length,
          },
        },
        400
      );
    }

    const [created] = await db
      .insert(submissions)
      .values({
        authorId,
        extensionId: existingExt?.id ?? null,
        versionId: null,
        type: existingExt ? "new_version" : "new_extension",
        githubRepo: repo,
        githubTag: ref,
        subpath,
        manifestSnapshot: manifest.raw,
        scanReport: scanReport as unknown as Record<string, unknown>,
        status: "pending",
      })
      .returning();

    const warnings = scanReport.findings.filter((f) => f.severity === "warn");

    trackServerEvent(
      "extension-submit",
      "/api/v1/submissions",
      {
        slug: manifest.slug,
        version: manifest.version,
        type: manifest.type,
        submissionType: existingExt ? "new_version" : "new_extension",
      },
      request,
    );

    return jsonResponse(
      {
        data: {
          id: created.id,
          status: created.status,
          slug: manifest.slug,
          version: manifest.version,
          type: manifest.type,
          bundleSource,
          scan: {
            fileCount: scanReport.fileCount,
            jsFiles: scanReport.jsFiles,
            cssFiles: scanReport.cssFiles,
            warnings,
          },
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return errorResponse("Unauthorized", 401);
    }
    console.error("Error creating submission:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
}
