// The build worker (a second pm2 app, worker/main.ts). It takes jobs from the
// submissions table, so the web process never builds, decodes images or
// holds the signing key. Order: publishing (approved, waiting to be signed
// and moved), then real submissions, then dry runs.
import fs from "fs/promises";
import path from "path";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "./db/client";
import { authors, downloadStats, extensions, oidcTokenUses, rateLimits, submissions } from "./db/schema";
import { processSubmission } from "./pipeline/process";
import { PublishError, publishSubmission, signPublishedVersions } from "./pipeline/publish";
import { clearStaging, stagingRoot } from "./pipeline/staging";
import { audit, SYSTEM } from "./audit";
import { queueNotification } from "./notify";
import { sendPending } from "./mailer";

const LEASE_MS = 20 * 60_000;
const DAY = 86_400_000;

type Submission = typeof submissions.$inferSelect;

function claim(status: "queued" | "publishing", dryRun?: boolean): Submission | null {
  const next = status === "publishing" ? "publishing" : "building";
  const rows = db.$client
    .prepare(
      `update submissions set status = ?, claimed_at = unixepoch(), attempts = attempts + 1
       where id = (select id from submissions where status = ? ${dryRun === undefined ? "" : "and dry_run = ?"}
                   and (claimed_at is null or ? = 'queued') order by submitted_at limit 1)
       returning id`
    )
    .all(...[next, status, ...(dryRun === undefined ? [] : [dryRun ? 1 : 0]), status]) as { id: string }[];
  if (!rows.length) return null;
  return db.select().from(submissions).where(eq(submissions.id, rows[0].id)).get() ?? null;
}

/** Runs one job if there is one. Returns whether it did any work. */
export async function runOnce(): Promise<boolean> {
  const publishing = claim("publishing");
  if (publishing) {
    try {
      await publishSubmission(publishing);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Back to the reviewer, with the reason.
      await db.update(submissions).set({ status: "awaiting_review", claimedAt: null, error: `Publishing failed: ${message}` }).where(eq(submissions.id, publishing.id));
      await audit(SYSTEM, "submission.publish_failed", { kind: "submission", id: publishing.id }, { error: message, expected: err instanceof PublishError });
    }
    return true;
  }
  const job = claim("queued", false) ?? claim("queued", true);
  if (!job) return false;
  await processSubmission(job);
  return true;
}

export async function recoverLeases(): Promise<void> {
  const stale = new Date(Date.now() - LEASE_MS);
  // A crashed build gets one more try.
  await db.update(submissions).set({ status: "queued", claimedAt: null })
    .where(and(eq(submissions.status, "building"), lt(submissions.claimedAt, stale), lt(submissions.attempts, 2)));
  await db.update(submissions).set({ status: "build_failed", claimedAt: null, error: "The build stopped responding twice", finishedAt: new Date() })
    .where(and(eq(submissions.status, "building"), lt(submissions.claimedAt, stale)));
  // A publish that died half way is safe to repeat (files are content-checked).
  db.$client.prepare("update submissions set claimed_at = null where status = 'publishing' and claimed_at < ?").run(Math.floor(stale.getTime() / 1000));
}

export async function housekeeping(now = new Date()): Promise<void> {
  const sec = (d: Date) => Math.floor(d.getTime() / 1000);
  await db.delete(oidcTokenUses).where(lt(oidcTokenUses.expiresAt, now));
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, sec(new Date(now.getTime() - 2 * DAY))));
  await db.delete(downloadStats).where(lt(downloadStats.downloadedAt, new Date(now.getTime() - 90 * DAY)));

  // Dry runs are kept a week; staged files of finished submissions a day.
  const oldDry = await db.select({ id: submissions.id }).from(submissions)
    .where(and(eq(submissions.dryRun, true), lt(submissions.submittedAt, new Date(now.getTime() - 7 * DAY))));
  for (const r of oldDry) await clearStaging(r.id).catch(() => {});
  if (oldDry.length) await db.delete(submissions).where(inArray(submissions.id, oldDry.map((r) => r.id)));
  try {
    const finished = new Set(["approved", "rejected", "withdrawn", "build_failed", "blocked", "dry_run_passed", "dry_run_failed"]);
    for (const dir of await fs.readdir(stagingRoot())) {
      const sub = db.select({ status: submissions.status, finishedAt: submissions.finishedAt }).from(submissions).where(eq(submissions.id, dir)).get();
      const stat = await fs.stat(path.join(stagingRoot(), dir));
      if ((!sub && stat.mtimeMs < now.getTime() - DAY) || (sub && finished.has(sub.status) && (sub.finishedAt?.getTime() ?? 0) < now.getTime() - DAY)) {
        await clearStaging(dir).catch(() => {});
      }
    }
  } catch {
    // no staging folder yet
  }

  // Reserved names with nothing published: warn after 83 days, release after 90.
  // An organization's reservations are kept: only staff create organizations,
  // and they hold names for the project's own extensions.
  const reserved = (await db.select({ e: extensions }).from(extensions).innerJoin(authors, eq(authors.id, extensions.authorId))
    .where(and(eq(extensions.status, "pending"), sql`${extensions.reservedAt} is not null`, eq(authors.kind, "user")))).map((r) => r.e);
  for (const ext of reserved) {
    const open = db.select({ id: submissions.id }).from(submissions)
      .where(and(eq(submissions.extensionId, ext.id), inArray(submissions.status, ["queued", "building", "awaiting_review", "publishing"]), eq(submissions.dryRun, false))).get();
    if (open) continue;
    const age = now.getTime() - ext.reservedAt!.getTime();
    if (age > 90 * DAY) {
      db.$client.transaction(() => {
        db.delete(submissions).where(eq(submissions.extensionId, ext.id)).run();
        db.delete(extensions).where(eq(extensions.id, ext.id)).run();
      })();
      await audit(SYSTEM, "extension.release_reservation", { kind: "extension", id: ext.id }, { slug: ext.slug });
      await queueNotification(ext.authorId, "reservation.released", { slug: ext.slug });
    } else if (age > 83 * DAY && !ext.reservationWarnedAt) {
      await db.update(extensions).set({ reservationWarnedAt: now }).where(eq(extensions.id, ext.id));
      await queueNotification(ext.authorId, "reservation.expiring", { slug: ext.slug, releaseOn: new Date(ext.reservedAt!.getTime() + 90 * DAY).toISOString().slice(0, 10) });
    }
  }
}

export async function startWorker(opts: { idleMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  const idle = opts.idleMs ?? 2000;
  const signed = await signPublishedVersions().catch((err) => {
    console.error("worker: signing published versions failed", err);
    return 0;
  });
  if (signed) console.log(`worker: signed ${signed} published versions`);
  let lastChores = 0;
  while (!opts.signal?.aborted) {
    try {
      if (Date.now() - lastChores > 60_000) {
        lastChores = Date.now();
        await recoverLeases();
        await housekeeping();
        await sendPending();
      }
      if (await runOnce()) continue;
    } catch (err) {
      console.error("worker:", err);
    }
    await new Promise((r) => setTimeout(r, idle));
  }
}
