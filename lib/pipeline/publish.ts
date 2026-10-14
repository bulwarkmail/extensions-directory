// Publishes an approved submission: the staged bundle and images move into
// uploads/, the release statement is signed, the version row is written and
// the extension's caches refreshed. Runs in the worker (it holds the signing
// key); approval in the web app only moves the submission to "publishing".
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { extensions, extensionVersions, screenshots, submissions } from "@/lib/db/schema";
import { validateManifest } from "@/lib/manifest";
import { getStoredFile, storeBundleFile, storeMedia } from "@/lib/storage";
import { onlineSigner, releaseStatement } from "@/lib/signing";
import { refreshLatest } from "@/lib/release-caches";
import { isPrerelease } from "@/lib/semver";
import { audit, SYSTEM } from "@/lib/audit";
import { queueNotification } from "@/lib/notify";
import { assertActorAllowed, Forbidden } from "@/lib/auth/guard";
import { clearStaging, readStaged } from "./staging";

type Submission = typeof submissions.$inferSelect;

export class PublishError extends Error {}

function mediaTarget(slug: string, staged: string): string {
  return `media/${slug}/${path.basename(staged)}`;
}

export async function publishSubmission(sub: Submission): Promise<void> {
  if (sub.status !== "publishing") throw new PublishError(`Submission is ${sub.status}`);
  if (!sub.extensionId || !sub.artifactPath || !sub.artifactSha256 || !sub.manifestSnapshot || !sub.version) {
    throw new PublishError("Submission was never built");
  }
  try {
    await assertActorAllowed(sub.authorId, sub.extensionId);
  } catch (err) {
    if (err instanceof Forbidden) throw new PublishError(err.message);
    throw err;
  }
  const v = validateManifest(sub.manifestSnapshot);
  if (!v.ok) throw new PublishError(v.error);
  const manifest = v.manifest;
  const [ext] = await db.select().from(extensions).where(eq(extensions.id, sub.extensionId)).limit(1);

  const bundle = await readStaged(sub.artifactPath);
  const sha256 = crypto.createHash("sha256").update(bundle).digest("hex");
  if (sha256 !== sub.artifactSha256) throw new PublishError("The staged bundle changed since it was built");

  // Never replace a published file: a version's bytes are fixed forever.
  const existing = await getStoredFile(`bundles/${ext.slug}/${sub.version}/${ext.slug}-${sub.version}.zip`);
  if (existing && crypto.createHash("sha256").update(existing).digest("hex") !== sha256) {
    throw new PublishError(`A different bundle for ${ext.slug} ${sub.version} is already stored`);
  }
  const stored = await storeBundleFile(ext.slug, sub.version, bundle);

  const media = sub.media ?? {};
  const moved: { icon?: string | null; banner?: string | null; screenshots: string[] } = { screenshots: [] };
  for (const [key, staged] of [["icon", media.icon], ["banner", media.banner]] as const) {
    if (!staged) continue;
    const target = mediaTarget(ext.slug, staged);
    await storeMedia(target, await readStaged(staged));
    moved[key] = target;
  }
  for (const staged of media.screenshots ?? []) {
    const target = mediaTarget(ext.slug, staged);
    await storeMedia(target, await readStaged(staged));
    moved.screenshots.push(target);
  }

  const approvedAt = new Date();
  const statement = releaseStatement({
    slug: ext.slug,
    version: sub.version,
    kind: manifest.type,
    bundle: { sha256, size: bundle.length },
    source: { host: sub.sourceHost, repo: sub.githubRepo, commit: sub.sourceCommit, subpath: sub.subpath },
    approvedAt: approvedAt.toISOString(),
  });
  const signer = onlineSigner();
  const claims = (sub.ciClaims ?? {}) as Record<string, string>;
  const versionId = crypto.randomUUID();
  const tags = Array.isArray(manifest.raw.tags) ? (manifest.raw.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 8) : null;

  const sqlite = db.$client;
  sqlite.transaction(() => {
    // Only one publisher wins, even if two workers ever ran.
    const claimed = db.update(submissions).set({ status: "approved", finishedAt: approvedAt }).where(and(eq(submissions.id, sub.id), eq(submissions.status, "publishing"))).run();
    if (claimed.changes !== 1) throw new PublishError("Submission was published or changed by someone else");
    db.insert(extensionVersions).values({
      id: versionId,
      extensionId: ext.id,
      version: sub.version!,
      changelog: sub.releaseNotes,
      changelogSource: sub.releaseNotes ? (typeof manifest.raw.changelog === "string" && manifest.raw.changelog.trim() === sub.releaseNotes ? "manifest" : "release") : null,
      bundlePath: stored.path,
      bundleSha256: sha256,
      bundleSize: bundle.length,
      permissions: manifest.permissions,
      minAppVersion: manifest.minAppVersion,
      manifest: manifest.raw,
      scanStatus: (sub.scanReport as { findings?: { severity: string }[] } | null)?.findings?.some((f) => f.severity === "warn") ? "flagged" : "clean",
      scanReport: sub.scanReport,
      reviewStatus: "approved",
      reviewNotes: sub.reviewNotes,
      reviewedBy: sub.reviewedBy,
      publishedAt: approvedAt,
      createdAt: approvedAt,
      channel: isPrerelease(sub.version!) ? "beta" : "stable",
      submissionId: sub.id,
      sourceHost: sub.sourceHost,
      sourceRepo: sub.githubRepo,
      sourceCommit: sub.sourceCommit,
      sourceRef: sub.githubTag,
      sourceSubpath: sub.subpath,
      submittedVia: sub.submittedVia,
      submittedBy: sub.authorId,
      ciWorkflowRef: claims.workflow_ref ?? null,
      ciRunId: claims.run_id ?? null,
      ciRunAttempt: claims.run_attempt ?? null,
      ciEvent: claims.event_name ?? null,
      builderImage: sub.builderImage,
      buildSource: sub.buildSource,
      provenance: { buildLogSha256: sub.buildLog ? crypto.createHash("sha256").update(sub.buildLog).digest("hex") : null, ci: sub.ciClaims ?? null },
      signature: signer ? signer.sign(statement) : null,
      signingKeyId: signer?.keyId ?? null,
      signedStatement: statement,
    }).run();
    db.update(submissions).set({ versionId }).where(eq(submissions.id, sub.id)).run();
    // Text that arrived with the version was reviewed with it.
    db.update(extensions).set({
      name: manifest.displayName,
      description: manifest.description,
      type: manifest.type,
      pluginType: manifest.pluginType,
      githubRepo: sub.githubRepo,
      subpath: sub.subpath,
      sourceHost: sub.sourceHost as typeof ext.sourceHost,
      license: typeof manifest.raw.license === "string" ? manifest.raw.license.slice(0, 64) : ext.license,
      ...(tags ? { tags } : {}),
      ...(media.icon !== undefined ? { iconPath: moved.icon ?? null } : {}),
      ...(media.banner !== undefined ? { bannerPath: moved.banner ?? null } : {}),
      status: ext.status === "pending" || ext.status === "rejected" ? "approved" : ext.status,
      reservedAt: null,
      updatedAt: approvedAt,
    }).where(eq(extensions.id, ext.id)).run();
    if (media.screenshots !== undefined) {
      db.delete(screenshots).where(eq(screenshots.extensionId, ext.id)).run();
      for (const [i, p] of moved.screenshots.entries()) db.insert(screenshots).values({ extensionId: ext.id, path: p, sortOrder: i }).run();
    }
    refreshLatest(sqlite, ext.id);
  })();

  await audit(SYSTEM, "version.publish", { kind: "version", id: versionId }, { slug: ext.slug, version: sub.version, sha256, signed: !!signer });
  await queueNotification(sub.authorId, "submission.approved", { submissionId: sub.id, slug: ext.slug, version: sub.version, notes: sub.reviewNotes });
  await clearStaging(sub.id).catch(() => {});
}

/** Sign every published version that has no signature from the current key. */
export async function signPublishedVersions(): Promise<number> {
  const signer = onlineSigner();
  if (!signer) return 0;
  const rows = await db
    .select({ v: extensionVersions, slug: extensions.slug, type: extensions.type })
    .from(extensionVersions)
    .innerJoin(extensions, eq(extensions.id, extensionVersions.extensionId));
  let n = 0;
  for (const { v, slug, type } of rows) {
    if (v.signingKeyId === signer.keyId && v.signature && v.signedStatement) continue;
    const statement = releaseStatement({
      slug,
      version: v.version,
      kind: type,
      bundle: { sha256: v.bundleSha256, size: v.bundleSize },
      source: { host: v.sourceHost ?? "github.com", repo: v.sourceRepo ?? "", commit: v.sourceCommit ?? null, subpath: v.sourceSubpath ?? "" },
      approvedAt: (v.publishedAt ?? v.createdAt ?? new Date(0)).toISOString(),
    });
    await db.update(extensionVersions).set({ signature: signer.sign(statement), signingKeyId: signer.keyId, signedStatement: statement }).where(eq(extensionVersions.id, v.id));
    n++;
  }
  if (n) await audit(SYSTEM, "versions.sign", null, { keyId: signer.keyId, count: n });
  return n;
}

export async function stagedExists(rel: string | null): Promise<boolean> {
  if (!rel) return false;
  return fs.access(path.join(process.env.STAGING_DIR || path.join(process.cwd(), "data", "staging"), rel)).then(() => true, () => false);
}
