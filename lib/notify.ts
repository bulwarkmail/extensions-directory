// Messages to authors. Code anywhere queues them here; the worker sends
// them (lib/mailer.ts) so a slow mail server never holds up a request.
import { db } from "./db/client";
import { notifications } from "./db/schema";

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

export async function queueNotification(authorId: string, kind: NotificationKind, payload: Record<string, unknown>): Promise<void> {
  await db.insert(notifications).values({ authorId, kind, payload });
}
