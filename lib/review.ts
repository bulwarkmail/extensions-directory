// Review decisions. Each is a compare-and-set on the submission status, so
// two reviewers can't both decide, and a decision on a stale page fails.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { directoryAdmins, submissions } from "./db/schema";
import { HttpError } from "./auth/session";
import { assertActorAllowed, Forbidden } from "./auth/guard";
import { audit, type Actor } from "./audit";
import { queueNotification } from "./notify";
import { clearStaging } from "./pipeline/staging";

function legacyReviewerId(authorId: string): string | null {
  // Older rows reference directory_admins; keep filling it where we can.
  return db.select({ id: directoryAdmins.id }).from(directoryAdmins).where(eq(directoryAdmins.authorId, authorId)).get()?.id ?? null;
}

function get(id: string) {
  const s = db.select().from(submissions).where(eq(submissions.id, id)).get();
  if (!s) throw new HttpError(404, "Submission not found", "not_found");
  return s;
}

export async function approveSubmission(id: string, reviewerId: string, notes: string | null, request?: Request) {
  const sub = get(id);
  if (sub.dryRun) throw new HttpError(400, "A dry run can't be approved", "dry_run");
  try {
    await assertActorAllowed(sub.authorId, sub.extensionId);
  } catch (err) {
    if (err instanceof Forbidden) throw new HttpError(409, `Can't approve: ${err.message}. Reject it instead.`, "not_allowed");
    throw err;
  }
  const res = db.update(submissions)
    .set({ status: "publishing", reviewedBy: reviewerId, reviewerId: legacyReviewerId(reviewerId), reviewNotes: notes, reviewedAt: new Date(), claimedAt: null, error: null })
    .where(and(eq(submissions.id, id), eq(submissions.status, "awaiting_review"))).run();
  if (res.changes !== 1) throw new HttpError(409, `Submission is ${get(id).status}, not waiting for review`, "conflict");
  await audit({ kind: "admin", id: reviewerId }, "submission.approve", { kind: "submission", id }, { slug: sub.slug, version: sub.version, selfReview: sub.authorId === reviewerId }, request);
}

export async function rejectSubmission(id: string, reviewerId: string, notes: string, request?: Request) {
  if (!notes.trim()) throw new HttpError(400, "Say why, so the author can fix it", "notes_required");
  const sub = get(id);
  const res = db.update(submissions)
    .set({ status: "rejected", reviewedBy: reviewerId, reviewerId: legacyReviewerId(reviewerId), reviewNotes: notes, reviewedAt: new Date(), finishedAt: new Date() })
    .where(and(eq(submissions.id, id), inArray(submissions.status, ["awaiting_review", "queued", "build_failed", "blocked"]), eq(submissions.dryRun, false))).run();
  if (res.changes !== 1) throw new HttpError(409, `Submission is ${sub.status} and can't be rejected`, "conflict");
  await audit({ kind: "admin", id: reviewerId }, "submission.reject", { kind: "submission", id }, { slug: sub.slug, version: sub.version, notes }, request);
  await queueNotification(sub.authorId, "submission.rejected", { submissionId: id, slug: sub.slug, version: sub.version, notes });
  await clearStaging(id).catch(() => {});
}

/** Build again from the same commit (e.g. after a build machine problem). */
export async function rebuildSubmission(id: string, actor: Actor, request?: Request) {
  const sub = get(id);
  const res = db.update(submissions).set({ status: "queued", attempts: 0, claimedAt: null, error: null, finishedAt: null })
    .where(and(eq(submissions.id, id), inArray(submissions.status, ["build_failed", "awaiting_review", "blocked"]))).run();
  if (res.changes !== 1) throw new HttpError(409, `Submission is ${sub.status} and can't be rebuilt`, "conflict");
  await audit(actor, "submission.rebuild", { kind: "submission", id }, {}, request);
}

export async function withdrawSubmission(id: string, actor: Actor, request?: Request) {
  const sub = get(id);
  const res = db.update(submissions).set({ status: "withdrawn", finishedAt: new Date() })
    .where(and(eq(submissions.id, id), inArray(submissions.status, ["queued", "awaiting_review", "build_failed", "blocked"]))).run();
  if (res.changes !== 1) throw new HttpError(409, `Submission is ${sub.status} and can't be withdrawn`, "conflict");
  await audit(actor, "submission.withdraw", { kind: "submission", id }, {}, request);
  await clearStaging(id).catch(() => {});
}
