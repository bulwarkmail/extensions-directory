// Scoped API tokens for CI outside GitHub and for scripts (plan, 7.3).
//
//   bwx_<12 id chars>_<40 secret chars><6 checksum chars>
//
// The checksum (CRC32 of the rest) catches typos without a database lookup
// and lets secret scanners recognize the format. Only an HMAC of the whole
// token is stored, keyed with TOKEN_PEPPER from .env.
import crypto from "crypto";
import zlib from "zlib";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { apiTokenExtensions, apiTokens, extensions, type TokenScope } from "@/lib/db/schema";
import { HttpError } from "./session";
import { isBanned, loadAuthor, memberRole } from "./guard";
import { audit, type Actor } from "@/lib/audit";
import { queueNotification } from "@/lib/notify";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN_RE = /^bwx_([0-9A-Za-z]{12})_([0-9A-Za-z]{40})([0-9A-Za-z]{6})$/;
export const MAX_TOKEN_DAYS = 365;

function randomBase62(n: number): string {
  const bytes = crypto.randomBytes(n * 2);
  let out = "";
  for (let i = 0; out.length < n && i < bytes.length; i++) if (bytes[i] < 248) out += ALPHABET[bytes[i] % 62];
  return out.length === n ? out : randomBase62(n);
}

function base62(num: number, width: number): string {
  let s = "";
  let n = num >>> 0;
  while (s.length < width) {
    s = ALPHABET[n % 62] + s;
    n = Math.floor(n / 62);
  }
  return s;
}

function checksum(body: string): string {
  return base62(zlib.crc32(body), 6);
}

function pepper(): string {
  const p = process.env.TOKEN_PEPPER;
  if (!p && process.env.NODE_ENV === "production") throw new Error("TOKEN_PEPPER is not set");
  return p || "dev-token-pepper";
}

export function hashToken(token: string): string {
  return crypto.createHmac("sha256", pepper()).update(token).digest("hex");
}

export function looksLikeToken(token: string): boolean {
  return token.startsWith("bwx_");
}

export function newTokenString(): { token: string; prefix: string } {
  const id = randomBase62(12);
  const body = `bwx_${id}_${randomBase62(40)}`;
  return { token: body + checksum(body), prefix: `bwx_${id}` };
}

export interface CreateTokenInput {
  authorId: string;
  name: string;
  extensionIds: string[];
  scopes: TokenScope[];
  days: number;
}

export async function createToken(input: CreateTokenInput, actor: Actor, request?: Request) {
  if (!input.name.trim() || input.name.length > 80) throw new HttpError(400, "Give the token a name (up to 80 characters)", "bad_request");
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_TOKEN_DAYS) throw new HttpError(400, `Expiry must be 1 to ${MAX_TOKEN_DAYS} days`, "bad_request");
  if (!input.scopes.length || input.scopes.some((s) => !["publish", "dry_run", "read"].includes(s))) throw new HttpError(400, "Pick at least one valid scope", "bad_request");
  if (!input.extensionIds.length || input.extensionIds.length > 50) throw new HttpError(400, "Pick 1 to 50 extensions", "bad_request");
  for (const id of input.extensionIds) {
    if (!(await memberRole(input.authorId, id))) throw new HttpError(403, "You can only scope tokens to your own extensions", "forbidden");
  }
  const { token, prefix } = newTokenString();
  const row = db.$client.transaction(() => {
    const t = db.insert(apiTokens).values({
      authorId: input.authorId, name: input.name.trim(), prefix, secretHash: hashToken(token), scopes: input.scopes,
      expiresAt: new Date(Date.now() + input.days * 86400_000),
    }).returning().get();
    for (const e of new Set(input.extensionIds)) db.insert(apiTokenExtensions).values({ tokenId: t.id, extensionId: e }).run();
    return t;
  })();
  await audit(actor, "token.create", { kind: "token", id: row.id }, { name: row.name, prefix, scopes: input.scopes, extensions: input.extensionIds, days: input.days }, request);
  return { token, row };
}

export interface TokenAuth {
  token: typeof apiTokens.$inferSelect;
  extensionIds: string[];
}

/** Checks a presented token. Throws 401 for anything wrong with the token itself. */
export async function authenticateToken(presented: string, ipHash: string | null): Promise<TokenAuth> {
  const m = TOKEN_RE.exec(presented);
  if (!m || checksum(presented.slice(0, -6)) !== m[3]) throw new HttpError(401, "Not a valid API token", "bad_token");
  const row = db.select().from(apiTokens).where(eq(apiTokens.prefix, `bwx_${m[1]}`)).get();
  const expected = row ? Buffer.from(row.secretHash, "hex") : Buffer.alloc(32);
  const actual = Buffer.from(hashToken(presented), "hex");
  if (!row || !crypto.timingSafeEqual(expected, actual)) throw new HttpError(401, "Not a valid API token", "bad_token");
  if (row.revokedAt) throw new HttpError(401, "This API token was revoked", "token_revoked");
  if (row.expiresAt.getTime() <= Date.now()) throw new HttpError(401, "This API token has expired", "token_expired");
  const owner = await loadAuthor(row.authorId);
  if (isBanned(owner)) throw new HttpError(403, "This account can't publish extensions", "banned");
  const ext = db.select({ id: apiTokenExtensions.extensionId }).from(apiTokenExtensions).where(eq(apiTokenExtensions.tokenId, row.id)).all();
  await db.update(apiTokens).set({ lastUsedAt: new Date(), lastUsedIpHash: ipHash }).where(eq(apiTokens.id, row.id));
  return { token: row, extensionIds: ext.map((e) => e.id) };
}

/** The scope and the extension must both be granted, and the owner still a member. */
export async function assertTokenAllows(auth: TokenAuth, scope: TokenScope, extensionId: string): Promise<void> {
  if (!auth.token.scopes.includes(scope)) throw new HttpError(403, `This token does not have the "${scope}" scope`, "scope");
  if (!auth.extensionIds.includes(extensionId)) throw new HttpError(403, "This token is not allowed to act on this extension", "scope");
  if (!(await memberRole(auth.token.authorId, extensionId))) throw new HttpError(403, "The token's owner is no longer a maintainer of this extension", "forbidden");
}

export async function revokeToken(tokenId: string, by: Actor, reason: string | null, request?: Request): Promise<void> {
  const row = db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)).get();
  if (!row) throw new HttpError(404, "Token not found", "not_found");
  if (row.revokedAt) return;
  await db.update(apiTokens).set({ revokedAt: new Date(), revokedBy: by.id ?? null, revokedReason: reason }).where(eq(apiTokens.id, tokenId));
  await audit(by, "token.revoke", { kind: "token", id: tokenId }, { prefix: row.prefix, reason }, request);
  if (by.id !== row.authorId) await queueNotification(row.authorId, "token.revoked", { name: row.name, prefix: row.prefix, reason });
}

export async function revokeAllTokensOf(authorId: string, by: Actor, reason: string): Promise<number> {
  const rows = db.select({ id: apiTokens.id }).from(apiTokens).where(and(eq(apiTokens.authorId, authorId))).all();
  for (const r of rows) await revokeToken(r.id, by, reason);
  return rows.length;
}

export function tokensOf(authorId: string) {
  const rows = db.select().from(apiTokens).where(eq(apiTokens.authorId, authorId)).all();
  const scopes = rows.length
    ? db.select({ tokenId: apiTokenExtensions.tokenId, slug: extensions.slug }).from(apiTokenExtensions)
        .innerJoin(extensions, eq(extensions.id, apiTokenExtensions.extensionId))
        .where(inArray(apiTokenExtensions.tokenId, rows.map((r) => r.id))).all()
    : [];
  return rows.map((r) => ({ ...r, secretHash: undefined, extensions: scopes.filter((s) => s.tokenId === r.id).map((s) => s.slug) }));
}
