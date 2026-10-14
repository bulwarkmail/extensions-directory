import { eq } from "drizzle-orm";
import crypto from "crypto";
import { db } from "@/lib/db/client";
import { submissions } from "@/lib/db/schema";
import { assertSameOrigin, currentUser, hasRole, HttpError } from "@/lib/auth/session";
import { memberRole } from "@/lib/auth/guard";
import { assertTokenAllows, authenticateToken, looksLikeToken } from "@/lib/auth/tokens";
import { clientIp, hashIp } from "@/lib/audit";
import { handle, ok } from "@/lib/http";
import { hit, LIMITS } from "@/lib/ratelimit";
import { bearer } from "@/lib/publishing/handler";
import { hashPollToken } from "@/lib/publishing/submit";
import { submissionView } from "@/lib/publishing/view";
import { withdrawSubmission } from "@/lib/review";

type Params = { params: Promise<{ id: string }> };

/**
 * Who may see a submission: the poll token from the publish response, an
 * API token scoped to its extension, or a signed-in maintainer or reviewer.
 */
async function authorize(request: Request, id: string, write: boolean) {
  const sub = db.select().from(submissions).where(eq(submissions.id, id)).get();
  const notFound = new HttpError(404, "Submission not found", "not_found");
  if (!sub) throw notFound;
  const credential = bearer(request);
  if (credential?.startsWith("bwp_")) {
    const okToken = !write && sub.pollTokenHash && sub.pollTokenExpiresAt && sub.pollTokenExpiresAt.getTime() > Date.now() &&
      crypto.timingSafeEqual(Buffer.from(sub.pollTokenHash, "hex"), Buffer.from(hashPollToken(credential), "hex"));
    if (!okToken) throw notFound;
    return { sub, actor: { kind: "anonymous" as const, id: null }, full: true };
  }
  if (credential && looksLikeToken(credential)) {
    const auth = await authenticateToken(credential, hashIp(clientIp(request)));
    await assertTokenAllows(auth, write ? "publish" : auth.token.scopes.includes("read") ? "read" : auth.token.scopes[0], sub.extensionId ?? "");
    return { sub, actor: { kind: "token" as const, id: auth.token.id }, full: true };
  }
  const user = await currentUser();
  if (user && write) assertSameOrigin(request);
  if (user && (hasRole(user.role, "reviewer") || (sub.extensionId && (await memberRole(user.id, sub.extensionId))))) {
    return { sub, actor: { kind: hasRole(user.role, "reviewer") ? ("admin" as const) : ("author" as const), id: user.id }, full: true };
  }
  throw notFound;
}

export const GET = handle(async (request: Request, { params }: Params) => {
  const { id } = await params;
  hit([LIMITS.pollPerSubmission(id)]);
  const { sub, full } = await authorize(request, id, false);
  return ok(submissionView(sub, { full }));
});

// Withdraw a submission that hasn't been decided yet.
export const DELETE = handle(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const { actor } = await authorize(request, id, true);
  await withdrawSubmission(id, actor, request);
  const sub = db.select().from(submissions).where(eq(submissions.id, id)).get()!;
  return ok(submissionView(sub));
});
