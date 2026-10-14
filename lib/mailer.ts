// Sends queued notifications (lib/notify.ts) by email and to webhooks. Runs
// in the worker. Email goes to the address GitHub reports as the author's
// verified primary address, from MAIL_FROM through SMTP_*.
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import nodemailer, { type Transporter } from "nodemailer";
import { db } from "./db/client";
import { authors, notifications } from "./db/schema";
import { deliverWebhooks } from "./webhooks";

const SITE = () => process.env.NEXT_PUBLIC_SITE_URL || "https://extensions.bulwarkmail.org";
const MAX_ATTEMPTS = 5;

type Payload = Record<string, unknown>;

export function renderMessage(kind: string, p: Payload): { subject: string; text: string } | null {
  const name = `${p.slug ?? "your extension"}${p.version ? ` ${p.version}` : ""}`;
  const link = p.submissionId ? `${SITE()}/dashboard/submissions/${p.submissionId}` : `${SITE()}/dashboard`;
  switch (kind) {
    case "submission.awaiting_review":
      return { subject: `${name} is waiting for review`, text: `${name} was built and passed the checks. A reviewer will look at it soon.\n\n${link}\n` };
    case "submission.approved":
      return { subject: `${name} is published`, text: `${name} was approved and is now available in the directory.${p.notes ? `\n\nReviewer notes:\n${p.notes}` : ""}\n\n${link}\n` };
    case "submission.rejected":
      return { subject: `${name} was not approved`, text: `A reviewer did not approve ${name}.\n\nReviewer notes:\n${p.notes ?? "(none)"}\n\n${link}\n` };
    case "submission.build_failed":
      return { subject: `${name} could not be built`, text: `The directory could not build ${name}:\n\n${p.error ?? ""}\n\nThe build log is on the submission page:\n${link}\n` };
    case "submission.blocked":
      return { subject: `${name} did not pass the checks`, text: `${name} was built but did not pass the checks:\n\n${p.error ?? ""}\n\n${link}\n` };
    case "text_change.approved":
      return { subject: `Your change to ${name} is live`, text: `A reviewer approved your change to the ${p.field} of ${name}.\n\n${SITE()}/extension/${p.slug}\n` };
    case "text_change.rejected":
      return { subject: `Your change to ${name} was not approved`, text: `A reviewer did not approve your change to the ${p.field} of ${name}.\n\nReviewer notes:\n${p.notes ?? "(none)"}\n` };
    case "reservation.expiring":
      return { subject: `${p.slug} will be released in 7 days`, text: `You reserved the name "${p.slug}" but no version has been published. Unless a version is submitted, the name is released on ${p.releaseOn}.\n\n${SITE()}/dashboard\n` };
    case "reservation.released":
      return { subject: `${p.slug} was released`, text: `No version of "${p.slug}" was published within 90 days, so the name was released.\n` };
    case "token.revoked":
      return { subject: `API token "${p.name}" was revoked`, text: `The API token "${p.name}" (${p.prefix}…) was revoked${p.reason ? `: ${p.reason}` : ""}.\n\n${SITE()}/dashboard/tokens\n` };
    case "report.malware":
      return { subject: `Malware report: ${p.slug}`, text: `Someone reported ${p.slug} as malware:\n\n${p.details}\n\n${SITE()}/admin/reports\n` };
    case "advisory.published":
      return { subject: `Security advisory for ${name}`, text: `${p.id}: ${p.summary}\n\n${SITE()}/extension/${p.slug}\n` };
    default:
      return null;
  }
}

let transport: Transporter | null | undefined;
function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  const host = process.env.SMTP_HOST;
  transport = host
    ? nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 465),
        secure: (process.env.SMTP_PORT || "465") === "465",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      })
    : null;
  return transport;
}

/** For tests. */
export function setTransport(t: Transporter | null): void {
  transport = t;
}

export async function sendPending(limit = 20): Promise<number> {
  const rows = await db
    .select({ n: notifications, email: authors.email, notifyEmail: authors.notifyEmail, banned: authors.banned })
    .from(notifications)
    .innerJoin(authors, eq(authors.id, notifications.authorId))
    .where(and(isNull(notifications.sentAt), lt(notifications.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
  let sent = 0;
  for (const { n, email, notifyEmail } of rows) {
    const message = renderMessage(n.kind, n.payload);
    let error: string | null = null;
    try {
      await deliverWebhooks(n.authorId, n.kind, n.payload);
      const t = getTransport();
      if (message && email && notifyEmail && t) {
        await t.sendMail({ from: process.env.MAIL_FROM || "Bulwark Extensions <noreply@bulwarkmail.org>", to: email, subject: message.subject, text: `${message.text}\n-- \nBulwark Extensions. Change email settings at ${SITE()}/dashboard/settings\n` });
        sent++;
      } else if (message && notifyEmail && !email) {
        error = "no email address";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await db.update(notifications).set({ attempts: n.attempts + 1, error }).where(eq(notifications.id, n.id));
      continue;
    }
    await db.update(notifications).set({ sentAt: new Date(), attempts: n.attempts + 1, error }).where(eq(notifications.id, n.id));
  }
  return sent;
}
