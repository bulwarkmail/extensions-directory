// Review decisions. Each is a compare-and-set on the submission status, so
// two reviewers can't both decide, and a decision on a stale page fails.
//
// Nobody approves their own work: not the submitter of a version or the
// proposer of a text change, and not a maintainer of the extension (directly
// or through the organization that owns it). A super admin may, by sending
// `selfReview: true`, so a directory run by one person keeps working; the
// audit log records it.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { directoryAdmins, submissions, textChanges } from "./db/schema";
import { HttpError } from "./auth/session";
import { assertActorAllowed, Forbidden, loadAuthor, memberRole } from "./auth/guard";
import { audit, type Actor } from "./audit";
import { queueNotification } from "./notify";
import { clearStaging } from "./pipeline/staging";
import { decideTextChange } from "./lifecycle";

/** Whether `reviewerId` wrote it (`authorId`) or maintains the extension. */
export async function isOwnWork(reviewerId: string, authorId: string | null, extensionId: string | null): Promise<boolean> {
  if (authorId === reviewerId) return true;
  return !!extensionId && !!(await memberRole(reviewerId, extensionId));
}

/**
 * Refuses (403) an approval of the reviewer's own work, unless a super admin
 * asks for it with `selfReview`. Returns whether it is their own work.
 */
async function assertMayApprove(reviewerId: string, authorId: string | null, extensionId: string | null, selfReview: boolean): Promise<boolean> {
  if (!(await isOwnWork(reviewerId, authorId, extensionId))) return false;
  const reviewer = await loadAuthor(reviewerId);
  if (reviewer?.role === "super_admin" && selfReview) return true;
  throw new HttpError(403, reviewer?.role === "super_admin"
    ? "You wrote this or maintain this extension. Send selfReview: true to approve it yourself, or leave it to another reviewer."
    : "You wrote this or maintain this extension, so another reviewer has to approve it.", "self_review");
}

function legacyReviewerId(authorId: string): string | null {
  // Older rows reference directory_admins; keep filling it where we can.
  return db.select({ id: directoryAdmins.id }).from(directoryAdmins).where(eq(directoryAdmins.authorId, authorId)).get()?.id ?? null;
}

function get(id: string) {
  const s = db.select().from(submissions).where(eq(submissions.id, id)).get();
  if (!s) throw new HttpError(404, "Submission not found", "not_found");
  return s;
}

export async function approveSubmission(id: string, reviewerId: string, notes: string | null, request?: Request, opts: { selfReview?: boolean } = {}) {
  const sub = get(id);
  if (sub.dryRun) throw new HttpError(400, "A dry run can't be approved", "dry_run");
  const selfReview = await assertMayApprove(reviewerId, sub.authorId, sub.extensionId, opts.selfReview === true);
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
  await audit({ kind: "admin", id: reviewerId }, "submission.approve", { kind: "submission", id }, { slug: sub.slug, version: sub.version, selfReview }, request);
}

/** A reviewer's decision on a text change; an approval is refused for the reviewer's own work as above. */
export async function decideTextChangeAsReviewer(id: string, approve: boolean, reviewerId: string, notes: string | null, request?: Request, opts: { selfReview?: boolean } = {}) {
  const tc = db.select().from(textChanges).where(eq(textChanges.id, id)).get();
  if (!tc) throw new HttpError(404, "Change not found", "not_found");
  const selfReview = approve ? await assertMayApprove(reviewerId, tc.proposedBy, tc.extensionId, opts.selfReview === true) : false;
  await decideTextChange(id, approve, reviewerId, notes, request);
  if (selfReview) await audit({ kind: "admin", id: reviewerId }, "text_change.self_review", { kind: "text_change", id }, { field: tc.field }, request);
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
