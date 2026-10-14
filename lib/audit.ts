// Append-only record of what staff, authors and machines did. No route
// updates or deletes these rows.
import crypto from "crypto";
import { db } from "./db/client";
import { auditLog } from "./db/schema";

export type ActorKind = "admin" | "author" | "token" | "oidc" | "system" | "anonymous";

export interface Actor {
  kind: ActorKind;
  /** Author id, token id, or the repository for OIDC. */
  id?: string | null;
}

export const SYSTEM: Actor = { kind: "system" };

const SALT = () => process.env.IP_HASH_SALT || process.env.AUTHOR_SESSION_SECRET || "extdir";

/** Salted hash of a client IP; never stored in the clear. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return crypto.createHmac("sha256", SALT()).update(ip.split(",")[0].trim()).digest("hex").slice(0, 32);
}

export function clientIp(request: Request): string | null {
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
}

export async function audit(
  actor: Actor,
  action: string,
  target: { kind: string; id: string } | null,
  details: Record<string, unknown> = {},
  request?: Request
): Promise<void> {
  await db.insert(auditLog).values({
    actorKind: actor.kind,
    actorId: actor.id ?? null,
    action,
    targetKind: target?.kind ?? null,
    targetId: target?.id ?? null,
    details,
    ipHash: request ? hashIp(clientIp(request)) : null,
  });
}
