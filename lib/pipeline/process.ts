// Turns a queued submission into a staged, reviewable build (or a finished
// dry run): resolve the commit, fetch the source at that commit, read the
// manifest, build, run the webmail's install checks and the scanner,
// re-encode the images, read the release notes, diff against the previous
// version, stage everything. Runs in the worker.
import crypto from "crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { extensions, extensionVersions, submissions, type StagedMedia } from "@/lib/db/schema";
import { validateManifest, type NormalizedManifest } from "@/lib/manifest";
import { scanBundle, type ScanReport } from "@/lib/scanner";
import { checkBundle } from "@/lib/webmail-compat";
import { WEBMAIL_SOURCE } from "@/lib/webmail-compat/vendor/source";
import { encodeImage, ImageError, MAX_INPUT_BYTES, type ImageKind } from "@/lib/images";
import { source as sourceFor } from "@/lib/sources";
import { getStoredFile } from "@/lib/storage";
import { assertActorAllowed, Forbidden } from "@/lib/auth/guard";
import { queueNotification } from "@/lib/notify";
import { BuildError, collectSource, openArchive, resolveBundleFiles, zipBundle } from "./resolve";
import { diffBundles, readZipFiles } from "./diff";
import { stage } from "./staging";
import { compare } from "@/lib/semver";

type Submission = typeof submissions.$inferSelect;

const MAX_SCREENSHOT_TOTAL = 2 * 1024 * 1024;

export class SubmissionFailure extends Error {
  constructor(message: string, readonly log = "", readonly blocked = false) {
    super(message);
  }
}

function tagName(ref: string): string | null {
  if (ref.startsWith("refs/tags/")) return ref.slice("refs/tags/".length);
  if (ref.startsWith("refs/") || /^[0-9a-f]{40}$/.test(ref)) return null;
  return ref;
}

async function stageMedia(submissionId: string, sourceFiles: Map<string, Uint8Array>, manifest: NormalizedManifest): Promise<StagedMedia> {
  const warnings: string[] = [];
  const one = async (rel: string, kind: ImageKind, name: string): Promise<{ staged: string; bytes: number } | null> => {
    const clean = rel.replace(/^\.?\//, "");
    const data = sourceFiles.get(clean);
    if (!data) {
      warnings.push(`${name}: ${rel} is not in the extension folder`);
      return null;
    }
    if (data.length > MAX_INPUT_BYTES[kind]) {
      warnings.push(`${name}: ${rel} is larger than ${MAX_INPUT_BYTES[kind] / 1024} KB`);
      return null;
    }
    try {
      const img = await encodeImage(Buffer.from(data), kind);
      return { staged: await stage(submissionId, `${name}-${img.hash}.${img.ext}`, img.data), bytes: data.length };
    } catch (err) {
      warnings.push(`${name}: ${err instanceof ImageError ? err.message : "could not be converted"}`);
      return null;
    }
  };
  const icon = manifest.icon ? (await one(manifest.icon, "icon", "icon"))?.staged ?? null : null;
  const banner = manifest.banner ? (await one(manifest.banner, "banner", "banner"))?.staged ?? null : null;
  const screenshots: string[] = [];
  let total = 0;
  for (let i = 0; i < manifest.screenshots.length; i++) {
    const s = await one(manifest.screenshots[i], "screenshot", `screenshot-${i + 1}`);
    if (!s) continue;
    total += s.bytes;
    if (total > MAX_SCREENSHOT_TOTAL) {
      warnings.push(`screenshot ${i + 1}: dropped, the screenshots add up to more than 2 MB`);
      break;
    }
    screenshots.push(s.staged);
  }
  return { icon, banner, screenshots, warnings };
}

async function previousRelease(extensionId: string) {
  const rows = await db
    .select()
    .from(extensionVersions)
    .where(and(eq(extensionVersions.extensionId, extensionId), eq(extensionVersions.reviewStatus, "approved")));
  const latest = rows.sort((a, b) => compare(b.version, a.version))[0];
  if (!latest) return null;
  const zip = await getStoredFile(latest.bundlePath);
  if (!zip) return null;
  return { version: latest.version, files: await readZipFiles(zip), manifest: latest.manifest };
}

/** Do the work; returns the fields to store. Throws SubmissionFailure. */
export async function buildSubmission(sub: Submission): Promise<Partial<Submission>> {
  if (!sub.extensionId) throw new SubmissionFailure("Submission has no extension");
  try {
    await assertActorAllowed(sub.authorId, sub.extensionId);
  } catch (err) {
    if (err instanceof Forbidden) throw new SubmissionFailure(err.message, "", true);
    throw err;
  }
  const [ext] = await db.select().from(extensions).where(eq(extensions.id, sub.extensionId)).limit(1);
  const src = sourceFor(sub.sourceHost);

  let commit = sub.sourceCommit;
  if (!commit) {
    commit = await src.resolveRef(sub.githubRepo, sub.githubTag);
    if (!commit) throw new SubmissionFailure(`"${sub.githubTag}" is not a branch, tag or commit of ${sub.githubRepo}`);
  }

  const archive = await src.archive(sub.githubRepo, commit);
  const { zip, top } = await openArchive(archive);
  const prefix = sub.subpath ? `${top}${sub.subpath}/` : top;
  const sourceFiles = await collectSource(zip, prefix);
  const manifestBytes = sourceFiles.get("manifest.json");
  if (!manifestBytes) {
    throw new SubmissionFailure(sub.subpath ? `No manifest.json in ${sub.subpath}/` : "No manifest.json at the repository root. For a monorepo, give the subpath of the extension.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  } catch {
    throw new SubmissionFailure("manifest.json is not valid JSON");
  }
  const v = validateManifest(raw);
  if (!v.ok) throw new SubmissionFailure(`manifest.json: ${v.error}`);
  const manifest = v.manifest;
  if (manifest.slug !== ext.slug) {
    throw new SubmissionFailure(`manifest.json has id "${manifest.slug}", but this submission is for "${ext.slug}"`);
  }
  if (sub.version && sub.version !== manifest.version && sub.submittedVia !== "legacy") {
    // The version is fixed when the submission is made from a known manifest.
    throw new SubmissionFailure(`The manifest at ${commit.slice(0, 7)} says version ${manifest.version}, not ${sub.version}`);
  }
  const published = await db
    .select({ id: extensionVersions.id })
    .from(extensionVersions)
    .where(and(eq(extensionVersions.extensionId, ext.id), eq(extensionVersions.version, manifest.version)))
    .limit(1);
  if (published.length) throw new SubmissionFailure(`Version ${manifest.version} is already published. Raise the version in manifest.json.`);
  const [hasRelease] = await db.select({ id: extensionVersions.id }).from(extensionVersions).where(eq(extensionVersions.extensionId, ext.id)).limit(1);
  if (hasRelease && ext.type !== manifest.type) {
    throw new SubmissionFailure(`"${ext.slug}" is a ${ext.type}; this manifest describes a ${manifest.type}`);
  }

  let resolved;
  try {
    resolved = await resolveBundleFiles(sourceFiles, manifest);
  } catch (err) {
    if (err instanceof BuildError) throw new SubmissionFailure(err.message, err.log);
    throw err;
  }
  const bundle = await zipBundle(resolved.files);
  const compat = await checkBundle(bundle, manifest.type, manifest.slug);
  const scan: ScanReport = await scanBundle({ files: resolved.files }, manifest);
  const sha256 = crypto.createHash("sha256").update(bundle).digest("hex");

  const fields: Partial<Submission> = {
    sourceCommit: commit,
    slug: manifest.slug,
    version: manifest.version,
    manifestSnapshot: manifest.raw,
    scanReport: scan as unknown as Record<string, unknown>,
    compatReport: { ok: compat.ok, errors: compat.errors, warnings: compat.warnings, webmail: WEBMAIL_SOURCE },
    buildLog: resolved.log || null,
    buildSource: resolved.source,
    builderImage: resolved.image,
    artifactSha256: sha256,
    artifactSize: bundle.length,
  };
  if (!compat.ok || scan.blocked) {
    const reasons = [
      ...compat.errors.map((e) => `Webmail would refuse it: ${e}`),
      ...scan.findings.filter((f) => f.severity === "block").map((f) => `${f.file ? `${f.file}: ` : ""}${f.message}`),
    ];
    throw Object.assign(new SubmissionFailure(reasons.join("\n"), resolved.log, true), { fields });
  }

  fields.artifactPath = await stage(sub.id, "bundle.zip", bundle);
  fields.media = await stageMedia(sub.id, sourceFiles, manifest);
  const tag = tagName(sub.githubTag);
  fields.releaseNotes = (tag ? await src.releaseNotes(sub.githubRepo, tag).catch(() => null) : null)
    ?? (typeof manifest.raw.changelog === "string" ? manifest.raw.changelog.slice(0, 20_000) : null);
  fields.diffSummary = diffBundles(await previousRelease(ext.id), { files: resolved.files, manifest: manifest.raw }) as unknown as Record<string, unknown>;
  return fields;
}

/** Run one claimed submission to its next state. */
export async function processSubmission(sub: Submission): Promise<Submission["status"]> {
  const done = (status: Submission["status"], extra: Partial<Submission>) =>
    db.update(submissions).set({ ...extra, status, finishedAt: new Date(), claimedAt: null }).where(and(eq(submissions.id, sub.id), eq(submissions.status, "building")));
  try {
    const fields = await buildSubmission(sub);
    const status = sub.dryRun ? "dry_run_passed" : "awaiting_review";
    await done(status, { ...fields, error: null });
    if (!sub.dryRun) {
      await queueNotification(sub.authorId, "submission.awaiting_review", { submissionId: sub.id, slug: fields.slug, version: fields.version });
      // Older open submissions of the same version are replaced by this one.
      await db.update(submissions).set({ status: "withdrawn", error: "Replaced by a newer submission" })
        .where(and(eq(submissions.extensionId, sub.extensionId!), eq(submissions.version, fields.version!), eq(submissions.status, "queued"), ne(submissions.id, sub.id)));
    }
    return status;
  } catch (err) {
    const failure = err instanceof SubmissionFailure ? err : null;
    const message = failure?.message ?? `Internal error while building: ${err instanceof Error ? err.message : String(err)}`;
    const extra = (err as { fields?: Partial<Submission> }).fields ?? {};
    const status = sub.dryRun ? "dry_run_failed" : failure?.blocked ? "blocked" : "build_failed";
    await done(status, { ...extra, error: message, buildLog: failure?.log || extra.buildLog || null });
    if (!sub.dryRun && sub.submittedVia !== "legacy") {
      await queueNotification(sub.authorId, status === "blocked" ? "submission.blocked" : "submission.build_failed", { submissionId: sub.id, slug: sub.slug, version: sub.version, error: message });
    }
    return status;
  }
}

/** The newest open submission of each extension, for lists. */
export async function latestSubmissions(extensionId: string, limit = 20) {
  return db.select().from(submissions).where(eq(submissions.extensionId, extensionId)).orderBy(desc(submissions.submittedAt)).limit(limit);
}
