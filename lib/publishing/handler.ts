// POST /api/v2/publish and /api/v2/publish/dry-run. Authenticates with a
// GitHub OIDC token (trusted publishing) or a bwx_ API token, then creates
// a submission. Never publishes: every version waits for a reviewer.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { extensions, publishers } from "@/lib/db/schema";
import { HttpError } from "@/lib/auth/session";
import { consumeJti, looksLikeJwt, matchPublisher, verifyGithubToken } from "@/lib/auth/oidc";
import { assertTokenAllows, authenticateToken, looksLikeToken } from "@/lib/auth/tokens";
import { memberRole } from "@/lib/auth/guard";
import { clientIp, hashIp } from "@/lib/audit";
import { hit, LIMITS } from "@/lib/ratelimit";
import { cleanSubpath } from "@/lib/sources";
import { fail, ok, readJson, str } from "@/lib/http";
import { createSubmission } from "./submit";
import { submissionView } from "./view";

export function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

const CLAIMS_KEPT = ["repository", "repository_id", "repository_owner_id", "sha", "ref", "workflow_ref", "run_id", "run_attempt", "actor", "event_name", "environment", "runner_environment"] as const;

export async function handlePublish(request: Request, dryRun: boolean): Promise<Response> {
  const ipHash = hashIp(clientIp(request)) ?? "unknown";
  hit([LIMITS.writesPerIp(ipHash)]);
  const credential = bearer(request);
  if (!credential) return fail(401, "unauthorized", "Send a GitHub OIDC token or an API token as Authorization: Bearer <token>");
  const body = await readJson(request);
  const subpath = cleanSubpath(str(body.subpath, "subpath", { optional: true, max: 200 }) ?? "");
  if (subpath === null) throw new HttpError(400, "subpath must be a folder inside the repository", "bad_subpath");
  const ref = str(body.ref, "ref", { optional: true, max: 250 });

  let result;
  if (looksLikeJwt(credential)) {
    const claims = await verifyGithubToken(credential);
    const target = await matchPublisher(claims, { subpath, ref, dryRun });
    const submitter = target.publisher.createdBy;
    if (!(await memberRole(submitter, target.extension.id))) {
      throw new HttpError(403, "The person who set up this trusted publisher is no longer a maintainer", "forbidden");
    }
    consumeJti(claims);
    result = await createSubmission({
      authorId: submitter,
      actor: { kind: "oidc", id: claims.repository },
      via: "oidc",
      extensionId: target.extension.id,
      host: "github.com",
      repo: claims.repository,
      ref: claims.ref,
      commit: claims.sha,
      subpath,
      dryRun,
      ciClaims: Object.fromEntries(CLAIMS_KEPT.filter((k) => claims[k] !== undefined).map((k) => [k, String(claims[k])])),
      request,
    });
    await db.update(publishers).set({ lastUsedAt: new Date() }).where(eq(publishers.id, target.publisher.id));
  } else if (looksLikeToken(credential)) {
    const auth = await authenticateToken(credential, ipHash);
    const slug = str(body.slug, "slug", { max: 64 })!;
    const ext = db.select().from(extensions).where(eq(extensions.slug, slug)).get();
    if (!ext) throw new HttpError(404, `No extension "${slug}"`, "not_found");
    await assertTokenAllows(auth, dryRun && auth.token.scopes.includes("dry_run") ? "dry_run" : "publish", ext.id);
    const repository = str(body.repository, "repository", { optional: true, max: 200 });
    if (repository && repository.toLowerCase() !== ext.githubRepo.toLowerCase()) {
      throw new HttpError(400, `This extension is built from ${ext.githubRepo}; change the source in the dashboard to use another repository`, "repo_mismatch");
    }
    if (body.subpath !== undefined && subpath !== ext.subpath) {
      throw new HttpError(400, `This extension is built from the subpath "${ext.subpath}"; change it in the dashboard`, "subpath_mismatch");
    }
    if (!ref) throw new HttpError(400, "ref is required (a tag, branch or commit)", "bad_request");
    result = await createSubmission({
      authorId: auth.token.authorId,
      actor: { kind: "token", id: auth.token.id },
      via: "token",
      tokenId: auth.token.id,
      extensionId: ext.id,
      host: ext.sourceHost,
      repo: ext.githubRepo,
      ref,
      subpath: ext.subpath,
      dryRun,
      request,
    });
  } else {
    return fail(401, "unauthorized", "Unknown credential; send a GitHub OIDC token or a bwx_ API token");
  }

  return ok({
    ...submissionView(result.submission),
    pollToken: result.pollToken,
    message: dryRun ? "Dry run queued; poll statusUrl for the result." : "Submitted. The build runs now; after that a reviewer looks at it.",
  }, 202);
}
