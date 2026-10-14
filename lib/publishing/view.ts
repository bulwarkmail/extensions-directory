// How a submission is shown to its author, CI and reviewers.
import { submissions } from "@/lib/db/schema";

type Submission = typeof submissions.$inferSelect;

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://extensions.bulwarkmail.org").replace(/\/+$/, "");
}

export function submissionUrls(id: string) {
  return {
    url: `${siteUrl()}/dashboard/submissions/${id}`,
    statusUrl: `${siteUrl()}/api/v2/submissions/${id}`,
  };
}

export const FINAL_STATUSES = new Set(["awaiting_review", "publishing", "approved", "rejected", "withdrawn", "build_failed", "blocked", "dry_run_passed", "dry_run_failed"]);

interface Finding { severity: string; rule: string; message: string; file?: string; line?: number }

export function submissionView(s: Submission, opts: { full?: boolean } = {}) {
  const scan = (s.scanReport ?? null) as { findings?: Finding[]; fileCount?: number } | null;
  const compat = (s.compatReport ?? null) as { ok?: boolean; errors?: string[]; warnings?: string[]; webmail?: string } | null;
  const decided = ["approved", "rejected"].includes(s.status);
  return {
    id: s.id,
    slug: s.slug,
    version: s.version,
    status: s.status,
    dryRun: s.dryRun,
    source: { host: s.sourceHost, repo: s.githubRepo, ref: s.githubTag, commit: s.sourceCommit, subpath: s.subpath },
    submittedVia: s.submittedVia,
    submittedAt: s.submittedAt,
    finishedAt: s.finishedAt,
    error: s.error,
    checks: {
      webmail: compat ? { ok: compat.ok ?? false, errors: compat.errors ?? [], warnings: compat.warnings ?? [], version: compat.webmail ?? null } : null,
      scan: scan ? { findings: scan.findings ?? [], fileCount: scan.fileCount ?? null } : null,
    },
    bundle: s.artifactSha256 ? { sha256: s.artifactSha256, size: s.artifactSize, builtWith: s.buildSource, image: s.builderImage } : null,
    review: decided ? { notes: s.reviewNotes, at: s.reviewedAt } : null,
    ...(opts.full ? { buildLog: s.buildLog, releaseNotes: s.releaseNotes, diff: s.diffSummary, media: s.media } : {}),
    ...submissionUrls(s.id),
  };
}
