// Trusted publishing with GitHub Actions OIDC (docs/rework-plan.md, 7.2).
// A workflow asks GitHub for a token with this directory as the audience;
// the token says which repository, workflow file, environment, ref and
// commit it was issued to. Nothing secret is stored here.
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, errors as joseErrors } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authors, extensions, oidcTokenUses, orgMembers, publishers } from "@/lib/db/schema";
import { audit, SYSTEM } from "@/lib/audit";
import { validateManifest } from "@/lib/manifest";
import { source } from "@/lib/sources";
import { hasRole, HttpError } from "./session";
import { isBanned } from "./guard";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const MAX_LIFETIME_SEC = 15 * 60;
const CLOCK_SKEW_SEC = 60;

export interface GithubClaims {
  jti: string;
  exp: number;
  iat: number;
  sub: string;
  repository: string;
  repository_id: string;
  repository_owner: string;
  repository_owner_id: string;
  workflow_ref: string;
  ref: string;
  ref_type?: string;
  sha: string;
  environment?: string;
  run_id: string;
  run_attempt: string;
  actor: string;
  event_name: string;
  runner_environment?: string;
}

let jwks: JWTVerifyGetKey | null = null;
/** Tests install a local key set. */
export function setJwks(keys: { keys: object[] } | null): void {
  jwks = keys ? createLocalJWKSet(keys as never) : null;
}
function keySet(): JWTVerifyGetKey {
  // jose caches the set, refetches when it sees an unknown kid, and spaces
  // those refetches out (cooldown), so a flood of bad kids can't hammer GitHub.
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`), { cooldownDuration: 60_000, cacheMaxAge: 3_600_000 });
  return jwks;
}

export function audience(): string {
  return process.env.OIDC_AUDIENCE || new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://extensions.bulwarkmail.org").origin;
}

export function looksLikeJwt(token: string): boolean {
  return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
}

/** Checks signature, issuer, audience and times. Throws 401 with the reason. */
export async function verifyGithubToken(token: string, now = Date.now()): Promise<GithubClaims> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, keySet(), {
      issuer: GITHUB_ISSUER,
      audience: audience(),
      algorithms: ["RS256"],
      clockTolerance: CLOCK_SKEW_SEC,
      currentDate: new Date(now),
      requiredClaims: ["exp", "iat", "jti", "repository_id", "repository_owner_id", "workflow_ref", "sha", "ref"],
    }));
  } catch (err) {
    const reason =
      err instanceof joseErrors.JWTExpired ? "token expired" :
      err instanceof joseErrors.JWTClaimValidationFailed ? `claim "${err.claim}" is wrong` :
      err instanceof joseErrors.JWKSNoMatchingKey ? "token not signed by GitHub" :
      err instanceof joseErrors.JWSSignatureVerificationFailed ? "bad signature" :
      err instanceof joseErrors.JOSEAlgNotAllowed ? "algorithm not allowed" :
      "not a valid GitHub Actions token";
    throw new HttpError(401, `OIDC token rejected: ${reason}`, "bad_token");
  }
  const exp = Number(payload.exp);
  const iat = Number(payload.iat);
  if (exp - iat > MAX_LIFETIME_SEC) throw new HttpError(401, "OIDC token rejected: lifetime too long", "bad_token");
  if (iat * 1000 > now + CLOCK_SKEW_SEC * 1000) throw new HttpError(401, "OIDC token rejected: issued in the future", "bad_token");
  for (const k of ["repository", "repository_id", "repository_owner_id", "workflow_ref", "sha", "ref", "jti"]) {
    if (typeof payload[k] !== "string" || !payload[k]) throw new HttpError(401, `OIDC token rejected: claim "${k}" missing`, "bad_token");
  }
  return payload as unknown as GithubClaims;
}

/** ".github/workflows/publish.yml" from "owner/repo/.github/workflows/publish.yml@refs/tags/v1". */
export function workflowPath(claims: Pick<GithubClaims, "workflow_ref" | "repository" | "ref">): string | null {
  const prefix = `${claims.repository}/`;
  if (!claims.workflow_ref.startsWith(prefix)) return null;
  const rest = claims.workflow_ref.slice(prefix.length);
  // The ref can hold an "@" itself (monorepo tags like "smime@1.3.1"), so cut
  // off the run's own ref rather than splitting at the last "@".
  const suffix = `@${claims.ref}`;
  if (claims.ref && rest.endsWith(suffix)) return rest.length > suffix.length ? rest.slice(0, -suffix.length) : null;
  const at = rest.indexOf("@");
  return at > 0 ? rest.slice(0, at) : null;
}

export interface PublishTarget {
  publisher: typeof publishers.$inferSelect;
  extension: typeof extensions.$inferSelect;
}

type Candidate = { p: typeof publishers.$inferSelect; e: typeof extensions.$inferSelect };

/**
 * Whether the account may name a repository with this GitHub owner id in a
 * trusted publisher: its own GitHub account, an organization author it is a
 * member of, or any repository for an admin. Checked when a row is added,
 * and against the token's owner for every publish through the row.
 */
export function mayPublishFrom(authorId: string | null | undefined, ownerId: string): boolean {
  if (!authorId) return false;
  const a = db.select({ githubId: authors.githubId, role: authors.role }).from(authors).where(eq(authors.id, authorId)).get();
  if (!a) return false;
  if (hasRole(a.role, "admin") || String(a.githubId) === ownerId) return true;
  return db.select({ githubId: authors.githubId }).from(orgMembers).innerJoin(authors, eq(authors.id, orgMembers.orgId))
    .where(and(eq(orgMembers.authorId, authorId), eq(authors.kind, "org"))).all()
    .some((o) => String(o.githubId) === ownerId);
}

/** A row of a suspended extension, or one whose extension owner or creator is banned, can't publish. */
function canPublish(c: Candidate): boolean {
  if (c.e.status === "suspended") return false;
  for (const id of new Set([c.e.authorId, c.p.createdBy])) {
    if (isBanned(db.select().from(authors).where(eq(authors.id, id)).get() ?? null)) return false;
  }
  return true;
}

/** The id in manifest.json of the folder this run publishes, or null when it can't be read. */
async function manifestIdAt(claims: GithubClaims, subpath: string): Promise<string | null> {
  try {
    const raw = await source("github.com").file(claims.repository, claims.sha, subpath ? `${subpath}/manifest.json` : "manifest.json", 512 * 1024);
    if (!raw) return null;
    const v = validateManifest(JSON.parse(raw.toString("utf8")));
    return v.ok ? v.manifest.slug : null;
  } catch {
    return null;
  }
}

/**
 * Of several rows that trust this run, the one for the extension whose id
 * the published folder's manifest.json names (without a readable manifest:
 * the extension built from this repository and folder). Of several rows of
 * that one extension, a row naming the run's environment wins over a row
 * that accepts any environment.
 */
async function pickOne(rows: Candidate[], claims: GithubClaims, subpath: string): Promise<Candidate> {
  const slug = await manifestIdAt(claims, subpath);
  let pick = slug
    ? rows.filter((c) => c.e.slug === slug)
    : rows.filter((c) => c.e.sourceHost === "github.com" && c.e.subpath === subpath &&
      (c.e.sourceRepoId ? c.e.sourceRepoId === claims.repository_id : c.e.githubRepo.toLowerCase() === claims.repository.toLowerCase()));
  const oneExtension = pick.length > 1 && new Set(pick.map((c) => c.e.id)).size === 1;
  if (oneExtension) {
    const exact = pick.filter((c) => c.p.environment && c.p.environment === claims.environment);
    if (exact.length) pick = exact;
  }
  if (pick.length === 1) return pick[0];
  if (oneExtension) throw new HttpError(409, `More than one trusted publisher of ${pick[0].e.slug} matches this run; remove the extra one`, "ambiguous");
  throw new HttpError(409, "More than one extension matches; give each a different subpath", "ambiguous");
}

/**
 * The one publisher this token may act for, given the request body's
 * subpath and ref. Doesn't use the token up (consumeJti does).
 */
export async function matchPublisher(claims: GithubClaims, body: { subpath: string; ref?: string; dryRun: boolean }): Promise<PublishTarget> {
  const path = workflowPath(claims);
  const rows = db
    .select({ p: publishers, e: extensions })
    .from(publishers)
    .innerJoin(extensions, eq(extensions.id, publishers.extensionId))
    .where(and(eq(publishers.repositoryId, claims.repository_id), eq(publishers.repositoryOwnerId, claims.repository_owner_id), isNull(publishers.disabledAt)))
    .all();
  // A row counts only while its creator could still add it: one whose creator
  // no longer owns the repository or belongs to its organization is left out
  // as if it weren't there, and logged by its id.
  const candidates: Candidate[] = [];
  for (const c of rows) {
    if (mayPublishFrom(c.p.createdBy, claims.repository_owner_id)) candidates.push(c);
    else await audit(SYSTEM, "publisher.skip", { kind: "publisher", id: c.p.id }, { slug: c.e.slug, createdBy: c.p.createdBy, reason: "creator_not_owner" });
  }
  if (!candidates.length) throw new HttpError(403, `No extension trusts publishing from ${claims.repository}`, "no_publisher");
  const byWorkflow = candidates.filter((c) => c.p.workflowPath === path);
  if (!byWorkflow.length) throw new HttpError(403, `Workflow ${path ?? claims.workflow_ref} is not a trusted publisher here`, "wrong_workflow");
  const byEnv = byWorkflow.filter((c) => !c.p.environment || c.p.environment === claims.environment);
  if (!byEnv.length) throw new HttpError(403, `This publisher requires the GitHub environment "${byWorkflow[0].p.environment}"`, "wrong_environment");
  const bySubpath = byEnv.filter((c) => c.p.subpath === body.subpath);
  if (!bySubpath.length) throw new HttpError(403, `No trusted publisher for subpath "${body.subpath}" in ${claims.repository}`, "wrong_subpath");
  // Rows that can't publish never count against the others; when no other
  // row is left, the checks below refuse with the reason.
  const usable = bySubpath.filter(canPublish);
  const target = usable.length > 1 ? await pickOne(usable, claims, body.subpath) : usable[0] ?? bySubpath[0];
  if (!body.dryRun && target.p.allowedRefs === "tags" && !claims.ref.startsWith("refs/tags/")) {
    throw new HttpError(403, `Publishing is only allowed from tags; this run is for ${claims.ref}`, "ref_not_allowed");
  }
  if (body.ref && body.ref !== claims.ref && `refs/tags/${body.ref}` !== claims.ref && `refs/heads/${body.ref}` !== claims.ref) {
    throw new HttpError(400, `ref "${body.ref}" is not the ref this workflow runs for (${claims.ref})`, "ref_mismatch");
  }
  if (target.e.status === "suspended") throw new HttpError(403, "This extension is suspended", "suspended");
  for (const id of new Set([target.e.authorId, target.p.createdBy])) {
    const a = db.select().from(authors).where(eq(authors.id, id)).get();
    if (isBanned(a ?? null)) throw new HttpError(403, "This account can't publish extensions", "banned");
  }
  return { publisher: target.p, extension: target.e };
}

/** Marks the token used. A second use fails, whatever happened the first time. */
export function consumeJti(claims: Pick<GithubClaims, "jti" | "exp">): void {
  const res = db.insert(oidcTokenUses).values({ jti: claims.jti, expiresAt: new Date(claims.exp * 1000) }).onConflictDoNothing().run();
  if (res.changes !== 1) throw new HttpError(409, "OIDC token was already used; request a new one", "token_reused");
}
