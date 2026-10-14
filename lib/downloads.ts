// Counting downloads. One count per IP, version and day, so a webmail that
// fetches a bundle to preview it and again to install it, or a retrying
// client, counts once. Raw rows (with a salted IP hash) are pruned after 90
// days by the worker; the per-day and per-version counts stay.
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db/client";
import { downloadDaily, downloadStats, extensions, extensionVersions } from "./db/schema";
import { clientIp, hashIp } from "./audit";

export function recordDownload(request: Request, extensionId: string, versionId: string, now = new Date()): boolean {
  const ipHash = hashIp(clientIp(request)) ?? "unknown";
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = dayStart.toISOString().slice(0, 10);
  return db.$client.transaction(() => {
    const seen = db.select({ id: downloadStats.id }).from(downloadStats)
      .where(and(eq(downloadStats.versionId, versionId), eq(downloadStats.ipHash, ipHash), gte(downloadStats.downloadedAt, dayStart))).get();
    if (seen) return false;
    db.insert(downloadStats).values({ extensionId, versionId, ipHash, userAgent: request.headers.get("user-agent")?.slice(0, 200) ?? null, downloadedAt: now }).run();
    db.insert(downloadDaily).values({ versionId, day, count: 1 })
      .onConflictDoUpdate({ target: [downloadDaily.versionId, downloadDaily.day], set: { count: sql`${downloadDaily.count} + 1` } }).run();
    db.update(extensionVersions).set({ downloadCount: sql`${extensionVersions.downloadCount} + 1` }).where(eq(extensionVersions.id, versionId)).run();
    db.update(extensions).set({ totalDownloads: sql`coalesce(${extensions.totalDownloads}, 0) + 1` }).where(eq(extensions.id, extensionId)).run();
    return true;
  })();
}

/** Daily downloads per version for an extension, oldest day first. */
export function downloadsByDay(extensionId: string, sinceDay: string) {
  return db.select({ version: extensionVersions.version, day: downloadDaily.day, count: downloadDaily.count })
    .from(downloadDaily)
    .innerJoin(extensionVersions, eq(extensionVersions.id, downloadDaily.versionId))
    .where(and(eq(extensionVersions.extensionId, extensionId), gte(downloadDaily.day, sinceDay)))
    .orderBy(downloadDaily.day).all();
}
