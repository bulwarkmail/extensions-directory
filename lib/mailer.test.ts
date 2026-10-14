import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { seed } from "@/tests/fixtures/seed";
import { db } from "./db/client";
import { notifications } from "./db/schema";
import { queueNotification } from "./notify";
import { renderMessage, sendPending, setTransport } from "./mailer";

beforeAll(seed);

describe("sendPending", () => {
  it("keeps notifications queued while SMTP is not set up", async () => {
    setTransport(null);
    await queueNotification("author-alice", "submission.approved", { slug: "jitsi-meet", version: "2.0.0", submissionId: "s1" });
    expect(await sendPending()).toBe(0);
    expect(db.select().from(notifications).all().every((n) => n.sentAt === null)).toBe(true);
  });

  it("sends them once it is, to the verified address, and marks them sent", async () => {
    const sent: { to: string; subject: string }[] = [];
    setTransport({ sendMail: async (m: { to: string; subject: string }) => { sent.push(m); return {}; } } as never);
    expect(await sendPending()).toBe(1);
    expect(sent).toEqual([expect.objectContaining({ to: "alice@example.com", subject: "jitsi-meet 2.0.0 is published" })]);
    expect(db.select().from(notifications).where(eq(notifications.authorId, "author-alice")).get()!.sentAt).not.toBeNull();
  });

  it("has a message for every kind it queues", () => {
    for (const kind of ["submission.awaiting_review", "submission.approved", "submission.rejected", "submission.build_failed", "submission.blocked",
      "text_change.approved", "text_change.rejected", "reservation.expiring", "reservation.released", "token.revoked", "advisory.published", "report.malware"]) {
      expect(renderMessage(kind, { slug: "x" }), kind).not.toBeNull();
    }
  });
});
