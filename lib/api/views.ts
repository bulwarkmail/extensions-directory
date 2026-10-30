// v2 response shapes. Unlike v1, these are designed: no database rows are
// passed through, and nothing private (emails, reviewer notes, scan reports
// of published versions) is in them.
import type { authors, extensions, extensionVersions } from "@/lib/db/schema";
import { noteFlags } from "@/lib/changelog";
import { siteUrl } from "@/lib/publishing/view";
import { compare } from "@/lib/semver";
import { source } from "@/lib/sources";

type Ext = typeof extensions.$inferSelect;
type Author = typeof authors.$inferSelect;
type Version = typeof extensionVersions.$inferSelect;

export const fileUrl = (p: string | null) => (p ? `${siteUrl()}/api/v1/files/${p}` : null);

export function authorView(a: Author | null) {
  return a ? { login: a.githubLogin, name: a.displayName, avatarUrl: a.avatarUrl, verified: !!a.verified, organization: a.kind === "org", url: `${siteUrl()}/author/${a.githubLogin}` } : null;
}

export function versionBrief(v: Version, slug: string) {
  return {
    version: v.version,
    channel: v.channel,
    publishedAt: v.publishedAt,
    minAppVersion: v.minAppVersion,
    maxAppVersion: v.maxAppVersion,
    permissions: v.permissions ?? [],
    size: v.bundleSize,
    sha256: v.bundleSha256,
    yanked: v.yankedAt ? { at: v.yankedAt, reason: v.yankReason } : null,
    downloadUrl: `${siteUrl()}/api/v2/extensions/${slug}/versions/${encodeURIComponent(v.version)}/bundle`,
  };
}

/**
 * The notes of every version an update from `installed` to `target` brings,
 * newest first: the versions above the installed one up to the target that
 * the caller's channel sees, yanked ones left out. At most 20.
 */
export function changelogsBetween(versions: Version[], installed: string, target: Version, channel: "stable" | "beta") {
  return versions
    .filter((v) => !v.yankedAt && (v.channel !== "beta" || channel === "beta")
      && compare(v.version, installed) > 0 && compare(v.version, target.version) <= 0)
    .sort((a, b) => compare(b.version, a.version))
    .slice(0, 20)
    .map((v) => ({ version: v.version, publishedAt: v.publishedAt, changelog: v.changelog, notes: noteFlags(v.changelog) }));
}

export function versionFull(v: Version, slug: string) {
  const host = v.sourceHost ?? "github.com";
  let src = null as ReturnType<typeof source> | null;
  try {
    src = source(host);
  } catch {
    src = null;
  }
  const runUrl = v.ciRunId && v.sourceRepo && host === "github.com" ? `https://github.com/${v.sourceRepo}/actions/runs/${v.ciRunId}${v.ciRunAttempt ? `/attempts/${v.ciRunAttempt}` : ""}` : null;
  return {
    ...versionBrief(v, slug),
    changelog: v.changelog,
    notes: noteFlags(v.changelog),
    downloads: v.downloadCount,
    provenance: {
      source: {
        host,
        repo: v.sourceRepo,
        ref: v.sourceRef,
        commit: v.sourceCommit,
        subpath: v.sourceSubpath,
        commitUrl: v.sourceCommit && v.sourceRepo && src ? src.commitUrl(v.sourceRepo, v.sourceCommit) : null,
      },
      submittedVia: v.submittedVia,
      ci: v.ciWorkflowRef ? { workflowRef: v.ciWorkflowRef, runId: v.ciRunId, runAttempt: v.ciRunAttempt, event: v.ciEvent, runUrl } : null,
      build: { builtWith: v.buildSource, image: v.builderImage },
    },
    signature: v.signature ? { keyId: v.signingKeyId, statement: v.signedStatement, signature: v.signature } : null,
  };
}

export function extensionSummary(e: Ext, a: Author | null, latest: Version | null, rating?: { average: number; count: number }) {
  return {
    slug: e.slug,
    name: e.name,
    type: e.type,
    pluginType: e.pluginType,
    description: e.description,
    tags: e.tags ?? [],
    license: e.license,
    featured: !!e.featured,
    status: e.status,
    iconUrl: fileUrl(e.iconPath),
    bannerUrl: fileUrl(e.bannerPath),
    author: authorView(a),
    latest: latest ? versionBrief(latest, e.slug) : null,
    downloads: e.totalDownloads ?? 0,
    rating: rating ?? { average: 0, count: 0 },
    deprecated: e.deprecatedAt ? { at: e.deprecatedAt, message: e.deprecationMessage, replacement: e.replacementSlug } : null,
    source: { host: e.sourceHost, repo: e.githubRepo, subpath: e.subpath },
    url: `${siteUrl()}/extension/${e.slug}`,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
