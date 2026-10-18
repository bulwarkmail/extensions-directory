// Creating a submission, the same way for the website, API tokens and OIDC.
// The quick checks happen here, so a CI job gets its answer at once; the
// build itself is the worker's (lib/pipeline/process.ts).
import crypto from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { extensionMembers, extensions, extensionVersions, OPEN_STATUSES, submissions, type SourceHost } from "@/lib/db/schema";
import { validateManifest } from "@/lib/manifest";
import { source, SourceError } from "@/lib/sources";
import { assertActorAllowed } from "@/lib/auth/guard";
import { HttpError } from "@/lib/auth/session";
import { hit, LIMITS, MAX_QUEUED, type Limit } from "@/lib/ratelimit";
import { audit, type Actor } from "@/lib/audit";

export interface SubmitRequest {
  authorId: string;
  actor: Actor;
  via: "web" | "oidc" | "token";
  tokenId?: string;
  /** The extension it is for; when missing, found or created by the manifest's id. */
  extensionId?: string;
  /** Website only: create a pending extension when the manifest's id is new. */
  allowCreate?: boolean;
  host: SourceHost;
  repo: string;
  ref: string;
  /** OIDC: the commit from the token; never resolved from the ref. */
  commit?: string;
  subpath: string;
  dryRun: boolean;
  ciClaims?: Record<string, unknown>;
  request?: Request;
}

export interface SubmitResult {
  submission: typeof submissions.$inferSelect;
  pollToken: string;
}

export function hashPollToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSubmission(req: SubmitRequest): Promise<SubmitResult> {
  await assertActorAllowed(req.authorId);
  const src = source(req.host);

  let info;
  try {
    info = await src.repoInfo(req.repo);
  } catch (err) {
    throw new HttpError(502, `Could not reach ${req.host}: ${err instanceof Error ? err.message : String(err)}`, "source_unavailable");
  }
  if (!info) throw new HttpError(400, `Repository ${req.repo} does not exist on ${req.host}`, "repo_not_found");
  if (!info.isPublic) throw new HttpError(400, `Repository ${req.repo} is not public`, "repo_private");

  const commit = req.commit ?? (await src.resolveRef(req.repo, req.ref).catch(() => null));
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new HttpError(400, `"${req.ref}" is not a branch, tag or commit of ${req.repo}`, "bad_ref");

  const manifestPath = req.subpath ? `${req.subpath}/manifest.json` : "manifest.json";
  let raw: Buffer | null;
  try {
    raw = await src.file(req.repo, commit, manifestPath, 512 * 1024);
  } catch (err) {
    throw new HttpError(502, `Could not read ${manifestPath}: ${err instanceof SourceError ? err.message : String(err)}`, "source_unavailable");
  }
  if (!raw) throw new HttpError(400, `No ${manifestPath} at ${commit.slice(0, 7)}${req.subpath ? "" : ". For a monorepo, give the subpath of the extension."}`, "no_manifest");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, `${manifestPath} is not valid JSON`, "bad_manifest");
  }
  const v = validateManifest(parsed);
  if (!v.ok) throw new HttpError(400, `${manifestPath}: ${v.error}`, "bad_manifest");
  const manifest = v.manifest;

  let ext = req.extensionId
    ? db.select().from(extensions).where(eq(extensions.id, req.extensionId)).get()
    : db.select().from(extensions).where(eq(extensions.slug, manifest.slug)).get();
  if (req.extensionId && !ext) throw new HttpError(404, "Extension not found", "not_found");
  if (ext && ext.slug !== manifest.slug) {
    throw new HttpError(400, `manifest.json has id "${manifest.slug}", but this is "${ext.slug}". Check the subpath.`, "slug_mismatch");
  }
  if (!ext) {
    if (!req.allowCreate) throw new HttpError(404, `No extension "${manifest.slug}" here yet. Create it in the dashboard first.`, "not_found");
    if (req.dryRun) throw new HttpError(400, `Create "${manifest.slug}" in the dashboard before running a dry run`, "not_found");
    ext = reserveExtension(req.authorId, { slug: manifest.slug, name: manifest.displayName, description: manifest.description, type: manifest.type, pluginType: manifest.pluginType, host: req.host, repo: req.repo, repoId: info.id, subpath: req.subpath });
    await audit(req.actor, "extension.reserve", { kind: "extension", id: ext.id }, { slug: ext.slug }, req.request);
  }
  await assertActorAllowed(req.authorId, ext.id);

  if (!req.dryRun) {
    const published = db.select({ id: extensionVersions.id }).from(extensionVersions)
      .where(and(eq(extensionVersions.extensionId, ext.id), eq(extensionVersions.version, manifest.version))).get();
    if (published) throw new HttpError(409, `Version ${manifest.version} of ${ext.slug} is already published. Raise the version in manifest.json.`, "version_exists");
    const open = db.select({ id: submissions.id, status: submissions.status }).from(submissions)
      .where(and(eq(submissions.extensionId, ext.id), eq(submissions.version, manifest.version), inArray(submissions.status, OPEN_STATUSES), eq(submissions.dryRun, false))).get();
    if (open) throw new HttpError(409, `Version ${manifest.version} is already submitted (${open.status}).`, "already_submitted");
  }

  const limits: Limit[] = req.dryRun
    ? [LIMITS.dryRunPerAuthor(req.authorId), LIMITS.dryRunPerRepo(`${req.host}/${req.repo}`)]
    : [LIMITS.publishPerExtension(ext.id), LIMITS.publishPerAuthor(req.authorId)];
  hit(limits);
  const queued = db.select({ n: sql<number>`count(*)` }).from(submissions).where(eq(submissions.status, "queued")).get()!.n;
  if (queued >= MAX_QUEUED) throw new HttpError(429, "The build queue is full; try again in a few minutes", "queue_full");

  const pollToken = `bwp_${crypto.randomBytes(24).toString("base64url")}`;
  const hasVersions = !!db.select({ id: extensionVersions.id }).from(extensionVersions).where(eq(extensionVersions.extensionId, ext.id)).get();
  const [submission] = await db.insert(submissions).values({
    extensionId: ext.id,
    authorId: req.authorId,
    type: hasVersions ? "new_version" : "new_extension",
    githubRepo: info.fullName,
    githubTag: req.ref,
    subpath: req.subpath,
    sourceHost: req.host,
    sourceCommit: commit,
    slug: manifest.slug,
    version: manifest.version,
    manifestSnapshot: manifest.raw,
    status: "queued",
    dryRun: req.dryRun,
    submittedVia: req.via,
    submittedByTokenId: req.tokenId ?? null,
    ciClaims: req.ciClaims ?? null,
    pollTokenHash: hashPollToken(pollToken),
    pollTokenExpiresAt: new Date(Date.now() + 2 * 3600_000),
  }).returning();
  await audit(req.actor, req.dryRun ? "submission.dry_run" : "submission.create", { kind: "submission", id: submission.id }, { slug: ext.slug, version: manifest.version, commit, via: req.via }, req.request);
  return { submission, pollToken };
}

/**
 * A pending extension owned by the author: the name is theirs until released.
 * `ownerMember` gets an owner row in extension_members; null for an
 * organization, whose members manage it through the organization.
 */
export function reserveExtension(authorId: string, e: { slug: string; name: string; description: string; type: "plugin" | "theme"; pluginType: "hook" | "ui-extension" | "sidebar-app" | null; host: SourceHost; repo: string; repoId?: string | null; subpath: string }, ownerMember: string | null = authorId) {
  const now = new Date();
  return db.$client.transaction(() => {
    const taken = db.select({ id: extensions.id }).from(extensions).where(eq(extensions.slug, e.slug)).get();
    if (taken) throw new HttpError(409, `The name "${e.slug}" is taken`, "slug_taken");
    const row = db.insert(extensions).values({
      slug: e.slug, name: e.name.slice(0, 100), description: e.description.slice(0, 500), type: e.type, pluginType: e.pluginType,
      authorId, githubRepo: e.repo, subpath: e.subpath, sourceHost: e.host, sourceRepoId: e.repoId ?? null,
      status: "pending", reservedAt: now, createdAt: now, updatedAt: now,
    }).returning().get();
    if (ownerMember) db.insert(extensionMembers).values({ extensionId: row.id, authorId: ownerMember, role: "owner", addedBy: ownerMember }).run();
    return row;
  })();
}
