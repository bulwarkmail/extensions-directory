// Scoped API tokens: format, storage, scopes, expiry, revocation, bans.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { seed } from "../fixtures/seed";
import { addRepo, fakeSource, plainPlugin, resetFakes, sha } from "../helpers/fake-source";
import { req } from "../helpers/http";

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  source: () => fakeSource,
}));

const { db } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const { createToken, revokeToken, hashToken } = await import("@/lib/auth/tokens");
const { POST } = await import("@/app/api/v2/publish/route");
const { POST: DRY } = await import("@/app/api/v2/publish/dry-run/route");
const { GET: STATUS } = await import("@/app/api/v2/submissions/[id]/route");

const alice = { kind: "author" as const, id: "author-alice" };
let v = 0;

beforeAll(seed);
beforeEach(() => {
  resetFakes();
  db.delete(schema.rateLimits).run();
  v++;
  addRepo("alice/plugins", {
    refs: { [`v4.${v}.0`]: sha(400 + v) },
    commits: { [sha(400 + v)]: Object.fromEntries(Object.entries(plainPlugin("jitsi-meet", `4.${v}.0`)).map(([k, c]) => [`jitsi-meet/${k}`, c])) },
  });
});

const make = (over: Partial<Parameters<typeof createToken>[0]> = {}) =>
  createToken({ authorId: "author-alice", name: "ci", extensionIds: ["ext-jitsi"], scopes: ["publish"], days: 30, ...over }, alice);

const publish = (t: string, body: Record<string, unknown> = {}, dry = false) =>
  (dry ? DRY : POST)(req("/api/v2/publish", { method: "POST", headers: { authorization: `Bearer ${t}` }, body: { slug: "jitsi-meet", ref: `v4.${v}.0`, ...body } }));

async function code(res: Response) {
  return { status: res.status, code: (await res.json()).error?.code };
}

describe("API tokens", () => {
  it("are shown once and stored only as a keyed hash", async () => {
    const { token, row } = await make();
    expect(token).toMatch(/^bwx_[0-9A-Za-z]{12}_[0-9A-Za-z]{46}$/);
    const stored = db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, row.id)).get()!;
    expect(JSON.stringify(stored)).not.toContain(token.slice(17));
    expect(stored.secretHash).toBe(hashToken(token));
    expect(stored.prefix).toBe(token.slice(0, 16));
  });

  it("publish the extension they are scoped to and record their use", async () => {
    const { token, row } = await make();
    const res = await publish(token);
    expect(res.status).toBe(202);
    expect((await res.json()).data).toMatchObject({ submittedVia: "token", slug: "jitsi-meet", source: { repo: "alice/plugins", subpath: "jitsi-meet" } });
    expect(db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, row.id)).get()!.lastUsedAt).not.toBeNull();
  });

  it("refuse a mistyped token before looking it up", async () => {
    const { token } = await make();
    const typo = token.slice(0, 20) + (token[20] === "a" ? "b" : "a") + token.slice(21);
    expect(await code(await publish(typo))).toEqual({ status: 401, code: "bad_token" });
  });

  it("refuse an unknown token with a valid checksum", async () => {
    const { newTokenString } = await import("@/lib/auth/tokens");
    expect(await code(await publish(newTokenString().token))).toEqual({ status: 401, code: "bad_token" });
  });

  it("refuse an expired token", async () => {
    const { token, row } = await make();
    await db.update(schema.apiTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.apiTokens.id, row.id));
    expect(await code(await publish(token))).toEqual({ status: 401, code: "token_expired" });
  });

  it("stop working the moment they are revoked", async () => {
    const { token, row } = await make();
    await revokeToken(row.id, alice, "leaked");
    expect(await code(await publish(token))).toEqual({ status: 401, code: "token_revoked" });
  });

  it("can't publish an extension outside their scope", async () => {
    const { token } = await make();
    expect(await code(await publish(token, { slug: "nord" }))).toEqual({ status: 403, code: "scope" });
  });

  it("with only the dry_run scope can't publish", async () => {
    const { token } = await make({ scopes: ["dry_run"] });
    expect(await code(await publish(token))).toEqual({ status: 403, code: "scope" });
    expect((await publish(token, {}, true)).status).toBe(202);
  });

  it("stop working when the owner leaves the extension", async () => {
    const { token } = await make();
    await db.delete(schema.extensionMembers).where(eq(schema.extensionMembers.authorId, "author-alice"));
    try {
      expect(await code(await publish(token))).toEqual({ status: 403, code: "forbidden" });
    } finally {
      await db.insert(schema.extensionMembers).values({ extensionId: "ext-jitsi", authorId: "author-alice", role: "owner" });
    }
  });

  it("stop working when the owner is banned", async () => {
    const { token } = await make();
    await db.update(schema.authors).set({ bannedAt: new Date() }).where(eq(schema.authors.id, "author-alice"));
    try {
      expect(await code(await publish(token))).toEqual({ status: 403, code: "banned" });
    } finally {
      await db.update(schema.authors).set({ bannedAt: null }).where(eq(schema.authors.id, "author-alice"));
    }
  });

  it("can't point the extension at another repository or subpath", async () => {
    const { token } = await make();
    expect(await code(await publish(token, { repository: "mallory/evil" }))).toEqual({ status: 400, code: "repo_mismatch" });
    expect(await code(await publish(token, { subpath: "other" }))).toEqual({ status: 400, code: "subpath_mismatch" });
  });

  it("can only be scoped to the creator's own extensions", async () => {
    await expect(make({ extensionIds: ["ext-nord"] })).rejects.toMatchObject({ status: 403 });
  });

  it("must expire within a year", async () => {
    await expect(make({ days: 400 })).rejects.toMatchObject({ status: 400 });
  });
});

describe("GET /api/v2/submissions/{id}", () => {
  it("answers the poll token from the publish response, and nothing else without auth", async () => {
    const { token } = await make();
    const { data } = await (await publish(token)).json();
    const get = (auth?: string) => STATUS(req(`/api/v2/submissions/${data.id}`, { headers: auth ? { authorization: `Bearer ${auth}` } : {} }), { params: Promise.resolve({ id: data.id }) });
    expect((await get(data.pollToken)).status).toBe(200);
    expect((await get("bwp_wrong")).status).toBe(404);
    expect((await get()).status).toBe(404);
    expect((await get(token)).status).toBe(200);
  });
});
