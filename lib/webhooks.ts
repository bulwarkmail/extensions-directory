// Author webhooks: a POST with the notification as JSON, signed with
// HMAC-SHA256 of the body (X-Bulwark-Signature: sha256=<hex>). Delivery
// never reaches private, loopback or link-local addresses: the host is
// resolved first, every address checked, and the request pinned to it.
import crypto from "crypto";
import dns from "dns/promises";
import https from "https";
import net from "net";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db/client";
import { webhooks } from "./db/schema";

export const WEBHOOK_EVENTS = [
  "submission.awaiting_review", "submission.approved", "submission.rejected",
  "submission.build_failed", "submission.blocked", "advisory.published",
] as const;

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return !privateV4(ip);
  if (!net.isIPv6(ip)) return false;
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return !privateV4(mapped[1]);
  // fc00::/7 unique local, fe80::/10 link local, ff00::/8 multicast,
  // 64:ff9b::/96 NAT64, 2002::/16 6to4, 2001:0000::/32 Teredo, 100::/64 discard.
  return !/^(f[cd]|fe[89ab]|ff|64:ff9b:|2002:|2001:0?:|100::|0:)/.test(v);
}

/** Checks a webhook URL when it is saved: https, a name, no port games. */
export function validWebhookUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || net.isIP(u.hostname.replace(/^\[|\]$/g, ""))) return null;
  if (u.port && u.port !== "443") return null;
  if (!/\./.test(u.hostname) || /\.(local|internal|localhost|lan|home|corp)$/i.test(u.hostname) || u.hostname === "localhost") return null;
  return u;
}

export async function resolvePublic(hostname: string): Promise<string> {
  const addrs = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addrs.length) throw new Error("does not resolve");
  for (const a of addrs) if (!isPublicAddress(a.address)) throw new Error(`resolves to a non-public address (${a.address})`);
  return addrs[0].address;
}

export function signBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function post(url: URL, ip: string, body: string, signature: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: ip, servername: url.hostname, port: 443, path: url.pathname + url.search, method: "POST",
      headers: { Host: url.host, "Content-Type": "application/json", "User-Agent": "bulwarkmail-extension-directory", "X-Bulwark-Signature": signature, "Content-Length": Buffer.byteLength(body) },
      timeout: 10_000,
    }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

export async function deliverWebhooks(authorId: string, kind: string, payload: Record<string, unknown>): Promise<void> {
  const hooks = await db.select().from(webhooks).where(and(eq(webhooks.authorId, authorId), isNull(webhooks.disabledAt)));
  for (const h of hooks) {
    if (!h.events.includes(kind)) continue;
    const body = JSON.stringify({ event: kind, at: new Date().toISOString(), data: payload });
    let status: string;
    try {
      const url = validWebhookUrl(h.url);
      if (!url) throw new Error("invalid URL");
      const ip = await resolvePublic(url.hostname);
      status = String(await post(url, ip, body, signBody(h.secret, body)));
    } catch (err) {
      status = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    await db.update(webhooks).set({ lastDeliveryAt: new Date(), lastStatus: status.slice(0, 200) }).where(eq(webhooks.id, h.id));
  }
}
