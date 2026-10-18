// Messages to authors. Code anywhere queues them here; the worker sends
// them (lib/mailer.ts) so a slow mail server never holds up a request.
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { authors, notifications, orgMembers } from "./db/schema";

export type NotificationKind =
  | "submission.awaiting_review"
  | "submission.approved"
  | "submission.rejected"
  | "submission.build_failed"
  | "submission.blocked"
  | "text_change.approved"
  | "text_change.rejected"
  | "reservation.expiring"
  | "reservation.released"
  | "token.revoked"
  | "advisory.published"
  | "report.malware";

/** An organization has no inbox; its owners get its messages. */
export async function queueNotification(authorId: string, kind: NotificationKind, payload: Record<string, unknown>): Promise<void> {
  const org = db.select({ kind: authors.kind }).from(authors).where(eq(authors.id, authorId)).get()?.kind === "org";
  const to = org ? db.select({ id: orgMembers.authorId, role: orgMembers.role }).from(orgMembers).where(eq(orgMembers.orgId, authorId)).all().filter((m) => m.role === "owner").map((m) => m.id) : [authorId];
  for (const id of to) await db.insert(notifications).values({ authorId: id, kind, payload });
}
