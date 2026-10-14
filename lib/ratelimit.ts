// Fixed-window counters in SQLite, so limits hold across restarts and are
// shared by the web app and the worker.
import { db } from "./db/client";
import { HttpError } from "./auth/session";

export interface Limit {
  key: string;
  max: number;
  windowSec: number;
}

/** Counts one hit against every limit; throws 429 when one is over. */
export function hit(limits: Limit[], now = Date.now()): void {
  const stmt = db.$client.prepare(
    `insert into rate_limits (key, window_start, count) values (?, ?, 1)
     on conflict(key, window_start) do update set count = count + 1 returning count`
  );
  const over: Limit[] = [];
  db.$client.transaction(() => {
    for (const l of limits) {
      const window = Math.floor(now / 1000 / l.windowSec) * l.windowSec;
      const { count } = stmt.get(l.key, window) as { count: number };
      if (count > l.max) over.push(l);
    }
  })();
  if (over.length) throw new HttpError(429, `Too many requests (${over[0].key.split(":")[0]}); try again later`, "rate_limited");
}

export const LIMITS = {
  publishPerExtension: (id: string): Limit => ({ key: `publish-ext:${id}`, max: 10, windowSec: 3600 }),
  publishPerAuthor: (id: string): Limit => ({ key: `publish-author:${id}`, max: 30, windowSec: 86400 }),
  dryRunPerAuthor: (id: string): Limit => ({ key: `dryrun-author:${id}`, max: 30, windowSec: 86400 }),
  dryRunPerRepo: (repo: string): Limit => ({ key: `dryrun-repo:${repo}`, max: 5, windowSec: 3600 }),
  writesPerIp: (ipHash: string): Limit => ({ key: `write-ip:${ipHash}`, max: 60, windowSec: 60 }),
  reportsPerIp: (ipHash: string): Limit => ({ key: `report-ip:${ipHash}`, max: 5, windowSec: 86400 }),
  pollPerSubmission: (id: string): Limit => ({ key: `poll:${id}`, max: 120, windowSec: 3600 }),
};

export const MAX_QUEUED = 50;
