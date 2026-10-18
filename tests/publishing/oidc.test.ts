// Trusted publishing: every claim check, through POST /api/v2/publish.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
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
const { setJwks, GITHUB_ISSUER } = await import("@/lib/auth/oidc");
const { POST } = await import("@/app/api/v2/publish/route");
const { POST: DRY } = await import("@/app/api/v2/publish/dry-run/route");

const AUD = "https://extensions.test";
let key: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  await seed();
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey as CryptoKey;
  otherKey = (await generateKeyPair("RS256")).privateKey as CryptoKey;
  setJwks({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
  await db.insert(schema.publishers).values({
    id: "pub-1", extensionId: "ext-jitsi", repository: "alice/plugins", repositoryId: "111", repositoryOwnerId: "222",
    workflowPath: ".github/workflows/publish.yml", environment: "release", subpath: "jitsi-meet", allowedRefs: "tags", createdBy: "author-alice",
  });
});

beforeEach(() => {
  resetFakes();
  db.delete(schema.rateLimits).run();
  addRepo("alice/plugins", {
    info: { id: "111", ownerId: "222" } as never,
    refs: { "v3.0.0": sha(31) },
    commits: {
      [sha(31)]: Object.fromEntries(Object.entries(plainPlugin("jitsi-meet", "3.0.0")).map(([k, v]) => [`jitsi-meet/${k}`, v])),
      [sha(32)]: Object.fromEntries(Object.entries(plainPlugin("jitsi-meet", "3.0.1")).map(([k, v]) => [`jitsi-meet/${k}`, v])),
      [sha(33)]: Object.fromEntries(Object.entries(plainPlugin("jitsi-meet", "3.0.2")).map(([k, v]) => [`jitsi-meet/${k}`, v])),
    },
  });
});

let n = 0;
async function token(over: Record<string, unknown> = {}, opts: { key?: CryptoKey; kid?: string; alg?: string; iat?: number; exp?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    repository: "alice/plugins", repository_id: "111", repository_owner: "alice", repository_owner_id: "222",
    workflow_ref: "alice/plugins/.github/workflows/publish.yml@refs/tags/v3.0.0", ref: "refs/tags/v3.0.0", ref_type: "tag",
    sha: sha(31), environment: "release", run_id: "999", run_attempt: "1", actor: "alice", event_name: "push",
    jti: `jti-${++n}`, ...over,
  };
  return new SignJWT(claims as never)
    .setProtectedHeader({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1" })
    .setIssuer((over.iss as string) ?? GITHUB_ISSUER)
    .setAudience((over.aud as string) ?? AUD)
    .setSubject("repo:alice/plugins:environment:release")
    .setIssuedAt(opts.iat ?? now)
    .setExpirationTime(opts.exp ?? now + 300)
    .sign(opts.key ?? key);
}

const publish = (t: string, body: Record<string, unknown> = { subpath: "jitsi-meet" }, dry = false) =>
  (dry ? DRY : POST)(req(dry ? "/api/v2/publish/dry-run" : "/api/v2/publish", { method: "POST", body, headers: { authorization: `Bearer ${t}` } }));

async function expectRefused(res: Response, status: number, code: string) {
  const body = await res.json();
  expect({ status: res.status, code: body.error?.code }).toEqual({ status, code });
}

describe("POST /api/v2/publish with a GitHub OIDC token", () => {
  it("creates a submission pinned to the token's commit", async () => {
    const res = await publish(await token());
    expect(res.status).toBe(202);
    const { data } = await res.json();
    expect(data).toMatchObject({ status: "queued", slug: "jitsi-meet", version: "3.0.0", source: { commit: sha(31), ref: "refs/tags/v3.0.0" }, submittedVia: "oidc" });
    expect(data.pollToken).toMatch(/^bwp_/);
    const row = db.select().from(schema.submissions).where(eq(schema.submissions.id, data.id)).get()!;
    expect(row.ciClaims).toMatchObject({ run_id: "999", workflow_ref: expect.stringContaining("publish.yml"), sha: sha(31) });
    expect(row.authorId).toBe("author-alice");
  });

  it("builds the token's commit even when the tag now points elsewhere", async () => {
    const res = await publish(await token({ sha: sha(32) }));
    const { data } = await res.json();
    expect(data).toMatchObject({ version: "3.0.1", source: { commit: sha(32) } });
  });

  it.each([
    ["wrong repository id (same name)", { repository_id: "999" }, 403, "no_publisher"],
    ["wrong owner id", { repository_owner_id: "999" }, 403, "no_publisher"],
    ["wrong workflow", { workflow_ref: "alice/plugins/.github/workflows/other.yml@refs/tags/v3.0.0" }, 403, "wrong_workflow"],
    ["workflow of another repo", { workflow_ref: "mallory/x/.github/workflows/publish.yml@refs/tags/v3.0.0" }, 403, "wrong_workflow"],
    ["missing environment", { environment: undefined }, 403, "wrong_environment"],
    ["wrong environment", { environment: "staging" }, 403, "wrong_environment"],
    ["a branch when only tags may publish", { ref: "refs/heads/main" }, 403, "ref_not_allowed"],
    ["wrong audience", { aud: "https://evil.example" }, 401, "bad_token"],
    ["wrong issuer", { iss: "https://evil.example" }, 401, "bad_token"],
  ])("refuses %s", async (_name, over, status, code) => {
    await expectRefused(await publish(await token(over)), status, code);
  });

  it("refuses an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectRefused(await publish(await token({}, { iat: now - 900, exp: now - 120 })), 401, "bad_token");
  });

  it("refuses a token that lives too long", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectRefused(await publish(await token({}, { iat: now, exp: now + 3600 })), 401, "bad_token");
  });

  it("refuses a token signed with another key, or an unknown key id", async () => {
    await expectRefused(await publish(await token({}, { key: otherKey })), 401, "bad_token");
    await expectRefused(await publish(await token({}, { kid: "k2" })), 401, "bad_token");
  });

  it("refuses an unsigned token", async () => {
    const t = await token();
    const [h, p] = t.split(".");
    const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url")}.${p}.`;
    void h;
    await expectRefused(await publish(`${none}x`), 401, "bad_token");
  });

  it("refuses a token used twice, and creates only one submission", async () => {
    const t = await token({ sha: sha(33) });
    expect((await publish(t)).status).toBe(202);
    await expectRefused(await publish(t), 409, "token_reused");
    expect(db.select().from(schema.submissions).where(eq(schema.submissions.sourceCommit, sha(33))).all()).toHaveLength(1);
  });

  it("refuses a body ref that isn't the token's ref", async () => {
    await expectRefused(await publish(await token(), { subpath: "jitsi-meet", ref: "v9.9.9" }), 400, "ref_mismatch");
  });

  it("refuses a subpath with no publisher", async () => {
    await expectRefused(await publish(await token(), { subpath: "other" }), 403, "wrong_subpath");
  });

  it("refuses when the extension's owner is banned", async () => {
    await db.update(schema.authors).set({ bannedAt: new Date() }).where(eq(schema.authors.id, "author-alice"));
    try {
      await expectRefused(await publish(await token()), 403, "banned");
    } finally {
      await db.update(schema.authors).set({ bannedAt: null }).where(eq(schema.authors.id, "author-alice"));
    }
  });

  it("refuses a suspended extension", async () => {
    await db.update(schema.extensions).set({ status: "suspended" }).where(eq(schema.extensions.id, "ext-jitsi"));
    try {
      await expectRefused(await publish(await token()), 403, "suspended");
    } finally {
      await db.update(schema.extensions).set({ status: "approved" }).where(eq(schema.extensions.id, "ext-jitsi"));
    }
  });

  it("allows a dry run from a pull request branch", async () => {
    const res = await publish(await token({ ref: "refs/pull/7/merge", workflow_ref: "alice/plugins/.github/workflows/publish.yml@refs/pull/7/merge" }), { subpath: "jitsi-meet" }, true);
    expect(res.status).toBe(202);
    expect((await res.json()).data.dryRun).toBe(true);
  });

  it("answers 401 without a credential", async () => {
    const res = await POST(req("/api/v2/publish", { method: "POST", body: {} }));
    expect(res.status).toBe(401);
  });
});

describe("trusted publishing for an organization's extension", () => {
  const ORG = "e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4";

  it("submits for an org member who set up the publisher, and stops when they leave the org", async () => {
    await db.insert(schema.extensions).values({ id: "ext-orgp", slug: "org-plugin", name: "Org plugin", type: "plugin", pluginType: "hook", authorId: ORG, description: "x", githubRepo: "alice/plugins", subpath: "org-plugin", status: "pending" });
    await db.insert(schema.orgMembers).values({ orgId: ORG, authorId: "author-alice", role: "member" });
    await db.insert(schema.publishers).values({
      id: "pub-org", extensionId: "ext-orgp", repository: "alice/plugins", repositoryId: "111", repositoryOwnerId: "222",
      workflowPath: ".github/workflows/publish.yml", environment: "release", subpath: "org-plugin", allowedRefs: "tags", createdBy: "author-alice",
    });
    addRepo("alice/plugins", { info: { id: "111", ownerId: "222" } as never, commits: {
      [sha(41)]: Object.fromEntries(Object.entries(plainPlugin("org-plugin", "1.0.0")).map(([k, v]) => [`org-plugin/${k}`, v])),
    } });
    const res = await publish(await token({ sha: sha(41) }), { subpath: "org-plugin" });
    expect(res.status).toBe(202);
    expect((await res.json()).data).toMatchObject({ slug: "org-plugin", version: "1.0.0" });

    await db.delete(schema.orgMembers).where(eq(schema.orgMembers.authorId, "author-alice"));
    await expectRefused(await publish(await token({ sha: sha(41) }), { subpath: "org-plugin" }), 403, "forbidden");
  });
});
