// Trusted publishing with GitHub Actions OIDC (docs/rework-plan.md, 7.2).
// A workflow asks GitHub for a token with this directory as the audience;
// the token says which repository, workflow file, environment, ref and
// commit it was issued to. Nothing secret is stored here.
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, errors as joseErrors } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authors, extensions, oidcTokenUses, publishers } from "@/lib/db/schema";
import { HttpError } from "./session";
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

/**
 * The one publisher this token may act for, given the request body's
 * subpath and ref. Doesn't use the token up (consumeJti does).
 */
export async function matchPublisher(claims: GithubClaims, body: { subpath: string; ref?: string; dryRun: boolean }): Promise<PublishTarget> {
  const path = workflowPath(claims);
  const candidates = db
    .select({ p: publishers, e: extensions })
    .from(publishers)
    .innerJoin(extensions, eq(extensions.id, publishers.extensionId))
    .where(and(eq(publishers.repositoryId, claims.repository_id), eq(publishers.repositoryOwnerId, claims.repository_owner_id), isNull(publishers.disabledAt)))
    .all();
  if (!candidates.length) throw new HttpError(403, `No extension trusts publishing from ${claims.repository}`, "no_publisher");
  const byWorkflow = candidates.filter((c) => c.p.workflowPath === path);
  if (!byWorkflow.length) throw new HttpError(403, `Workflow ${path ?? claims.workflow_ref} is not a trusted publisher here`, "wrong_workflow");
  const byEnv = byWorkflow.filter((c) => !c.p.environment || c.p.environment === claims.environment);
  if (!byEnv.length) throw new HttpError(403, `This publisher requires the GitHub environment "${byWorkflow[0].p.environment}"`, "wrong_environment");
  const bySubpath = byEnv.filter((c) => c.p.subpath === body.subpath);
  if (!bySubpath.length) throw new HttpError(403, `No trusted publisher for subpath "${body.subpath}" in ${claims.repository}`, "wrong_subpath");
  if (bySubpath.length > 1) throw new HttpError(409, "More than one extension matches; give each a different subpath", "ambiguous");
  const target = bySubpath[0];
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
