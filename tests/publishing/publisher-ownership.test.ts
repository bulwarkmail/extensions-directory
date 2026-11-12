// Who may add a trusted publisher, and which extension a publish goes to.
//
// A trusted publisher row says "a GitHub Actions run of this workflow in this
// repository may publish this extension". A row may only name a repository
// owned by the account's own GitHub account or by an organization author the
// account is a member of; admins may name any repository. A publish goes to
// the extension whose id the published folder's manifest.json names, so a
// row on another extension for the same repository and folder never blocks
// it or receives it.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { and, eq, inArray } from "drizzle-orm";
import { seed } from "../fixtures/seed";
import { addRepo, fakeSource, plainPlugin, resetFakes, sha } from "../helpers/fake-source";
import { req, BASE } from "../helpers/http";
import { signIn, signOut } from "../helpers/session";

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  source: () => fakeSource,
}));

const { db } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const { setJwks, GITHUB_ISSUER } = await import("@/lib/auth/oidc");
const { POST: PUBLISH } = await import("@/app/api/v2/publish/route");
const { router } = await import("@/lib/api/router");
const { v2Routes } = await import("@/lib/api/v2");

const dispatch = router(v2Routes);
const send = async (method: "POST" | "PATCH", path: string, body: unknown) => {
  const res = await dispatch(method)(req(`/api/v2${path}`, { method, body, headers: { origin: new URL(BASE).origin } }));
  return { status: res.status, body: await res.json() };
};
const post = (path: string, body: unknown) => send("POST", path, body);

let key: CryptoKey;
let n = 0;
/** A token as GitHub issues it to alice/plugins' publish workflow for a tag. */
async function aliceToken(tag: string, commit: string, over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    repository: "alice/plugins", repository_id: "111", repository_owner: "alice", repository_owner_id: "222",
    workflow_ref: `alice/plugins/.github/workflows/publish.yml@refs/tags/${tag}`, ref: `refs/tags/${tag}`, ref_type: "tag",
    sha: commit, environment: "release", run_id: "999", run_attempt: "1", actor: "alice", event_name: "push", jti: `own-${++n}`, ...over,
  } as never).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(GITHUB_ISSUER).setAudience("https://extensions.test")
    .setSubject("repo:alice/plugins:environment:release").setIssuedAt(now).setExpirationTime(now + 300).sign(key);
}
const publish = (token: string, subpath: string) =>
  PUBLISH(req("/api/v2/publish", { method: "POST", body: { subpath }, headers: { authorization: `Bearer ${token}` } }));

beforeAll(async () => {
  await seed();
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey as CryptoKey;
  setJwks({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
  await db.insert(schema.authors).values({ id: "mallory", githubId: 6001, githubLogin: "mallory", displayName: "Mallory" });
  // alice's own trusted publisher for her plugin in alice/plugins/jitsi-meet.
  await db.insert(schema.publishers).values({
    id: "pub-alice", extensionId: "ext-jitsi", repository: "alice/plugins", repositoryId: "111", repositoryOwnerId: "222",
    workflowPath: ".github/workflows/publish.yml", environment: "release", subpath: "jitsi-meet", allowedRefs: "tags", createdBy: "author-alice",
  });
});

beforeEach(() => {
  signOut();
  resetFakes();
  db.delete(schema.rateLimits).run();
  // alice's repository (GitHub ids 111 / 222): her listed plugin and a new one she has not registered yet.
  addRepo("alice/plugins", {
    info: { id: "111", ownerId: "222" } as never,
    refs: {},
    commits: {
      [sha(41)]: Object.fromEntries(Object.entries(plainPlugin("jitsi-meet", "4.0.0")).map(([k, v]) => [`jitsi-meet/${k}`, v])),
      [sha(42)]: Object.fromEntries(Object.entries(plainPlugin("new-official", "1.0.0")).map(([k, v]) => [`new-official/${k}`, v])),
    },
  });
  // mallory's own repository (GitHub ids 333 / 6001).
  addRepo("mallory/stuff", { info: { id: "333", ownerId: "6001" } as never, refs: {}, commits: { [sha(43)]: plainPlugin("mallory-ext", "1.0.0") } });
});

describe("a trusted publisher for a repository the account has nothing to do with", () => {
  it("can't make that repository's own publish ambiguous", async () => {
    await signIn("mallory");
    expect((await post("/extensions", { slug: "mallory-ext", repository: "mallory/stuff", type: "plugin" })).status).toBe(201);
    // Whatever this answers, alice's publish must keep working.
    await post("/extensions/mallory-ext/publishers", { repository: "alice/plugins", workflowPath: ".github/workflows/publish.yml", subpath: "jitsi-meet" });
    signOut();

    const res = await publish(await aliceToken("jitsi-meet@4.0.0", sha(41)), "jitsi-meet");
    const body = await res.json();
    expect({ status: res.status, code: body.error?.code }).toEqual({ status: 202, code: undefined });
    expect(db.select().from(schema.submissions).where(eq(schema.submissions.id, body.data.id)).get()!.authorId).toBe("author-alice");
  });

  it("can't receive that repository's publish under a name the stranger reserved", async () => {
    await signIn("mallory");
    expect((await post("/extensions", { slug: "new-official", repository: "mallory/stuff", type: "plugin" })).status).toBe(201);
    await post("/extensions/new-official/publishers", { repository: "alice/plugins", workflowPath: ".github/workflows/publish.yml", subpath: "new-official" });
    signOut();

    // alice tags her new plugin; her workflow asks the directory to publish the folder.
    await publish(await aliceToken("new-official@1.0.0", sha(42)), "new-official");
    const captured = db.select().from(schema.submissions)
      .where(and(eq(schema.submissions.authorId, "mallory"), eq(schema.submissions.githubRepo, "alice/plugins"))).all();
    expect(captured).toEqual([]);
  });
});

describe("adding a trusted publisher", () => {
  beforeAll(async () => {
    await db.insert(schema.authors).values([
      { id: "staff", githubId: 3001, githubLogin: "staff", displayName: "Staff", role: "admin" },
      { id: "org-acme", githubId: 7001, githubLogin: "acme", displayName: "Acme", kind: "org" },
      { id: "olga", githubId: 7002, githubLogin: "olga", displayName: "Olga" },
    ]);
    await db.insert(schema.orgMembers).values({ orgId: "org-acme", authorId: "olga", role: "member" });
    await db.insert(schema.extensions).values({
      id: "ext-acme", slug: "acme-thing", name: "Acme thing", type: "plugin", pluginType: "hook", authorId: "org-acme", description: "x",
      githubRepo: "acme/plugins", subpath: "acme-thing", status: "pending", reservedAt: new Date(),
    });
  });

  beforeEach(() => {
    // A repository of alice's own GitHub account (id 1001), and one of the acme organization (id 7001).
    addRepo("alice/own", { info: { id: "555", ownerId: "1001" } as never, commits: {} });
    addRepo("acme/plugins", { info: { id: "777", ownerId: "7001" } as never, commits: {} });
  });

  it("works for an author, for a repository of their own GitHub account", async () => {
    await signIn("author-alice");
    const r = await post("/extensions/jitsi-meet/publishers", { repository: "alice/own", workflowPath: ".github/workflows/publish.yml", subpath: "own" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ repositoryId: "555", repositoryOwnerId: "1001", createdBy: "author-alice" });
  });

  it("works for a member of an organization author, for a repository of that organization", async () => {
    await signIn("olga");
    const r = await post("/extensions/acme-thing/publishers", { repository: "acme/plugins", workflowPath: ".github/workflows/publish.yml", environment: "extensions", subpath: "acme-thing" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ repositoryId: "777", repositoryOwnerId: "7001", createdBy: "olga" });
  });

  it("works for an admin, for any repository", async () => {
    await signIn("staff");
    const r = await post("/extensions/jitsi-meet/publishers", { repository: "acme/plugins", workflowPath: ".github/workflows/publish.yml", subpath: "staff-added" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ repositoryId: "777", repositoryOwnerId: "7001", createdBy: "staff" });
  });

  it("is refused for an author, for a repository of an organization they are not a member of", async () => {
    await signIn("author-alice");
    const r = await post("/extensions/jitsi-meet/publishers", { repository: "acme/plugins", workflowPath: ".github/workflows/publish.yml", subpath: "acme-thing" });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/staff/);
    expect(db.select().from(schema.publishers).where(and(eq(schema.publishers.repositoryId, "777"), eq(schema.publishers.createdBy, "author-alice"))).all()).toEqual([]);
  });
});

describe("matching a publish to one extension", () => {
  beforeAll(async () => {
    await db.insert(schema.authors).values({ id: "squatter", githubId: 6002, githubLogin: "squatter", displayName: "Squatter" });
    await db.insert(schema.extensions).values({
      id: "ext-squat", slug: "squatted", name: "Squatted", type: "plugin", pluginType: "hook", authorId: "squatter", description: "x",
      githubRepo: "squatter/x", subpath: "", status: "pending", reservedAt: new Date(),
    });
    await db.insert(schema.extensionMembers).values({ extensionId: "ext-squat", authorId: "squatter", role: "owner" });
  });

  beforeEach(() => {
    const folder = (dir: string, id: string, version: string) =>
      Object.fromEntries(Object.entries(plainPlugin(id, version)).map(([k, v]) => [`${dir}/${k}`, v]));
    addRepo("alice/plugins", {
      info: { id: "111", ownerId: "222" } as never,
      refs: {},
      commits: {
        [sha(51)]: folder("jitsi-meet", "jitsi-meet", "4.1.0"),
        [sha(52)]: folder("jitsi-meet", "jitsi-meet", "4.2.0"),
        [sha(53)]: folder("jitsi-meet", "jitsi-meet", "4.3.0"),
        [sha(54)]: folder("jitsi-meet", "jitsi-meet", "4.4.0"),
        [sha(55)]: folder("jitsi-meet", "jitsi-meet", "4.5.0"),
        [sha(56)]: folder("jitsi-meet", "jitsi-meet", "4.6.0"),
        [sha(57)]: folder("jitsi-meet", "jitsi-meet", "4.7.0"),
        [sha(58)]: folder("spare", "squatted", "1.0.0"),
      },
    });
  });

  afterEach(() => {
    db.delete(schema.publishers).where(inArray(schema.publishers.id, ["pub-other", "pub-alice-any", "pub-spare"])).run();
    db.update(schema.extensions).set({ status: "pending" }).where(eq(schema.extensions.id, "ext-squat")).run();
    db.update(schema.authors).set({ bannedAt: null }).where(eq(schema.authors.id, "squatter")).run();
  });

  /** A row on another extension for alice's repository, workflow and folder, as staff could have added it. */
  const otherRow = (over: Partial<typeof schema.publishers.$inferInsert> = {}) => db.insert(schema.publishers).values({
    id: "pub-other", extensionId: "ext-squat", repository: "alice/plugins", repositoryId: "111", repositoryOwnerId: "222",
    workflowPath: ".github/workflows/publish.yml", environment: null, subpath: "jitsi-meet", allowedRefs: "tags", createdBy: "squatter", ...over,
  }).run();

  async function expectAlices(res: Response) {
    const body = await res.json();
    expect({ status: res.status, code: body.error?.code }).toEqual({ status: 202, code: undefined });
    expect(db.select().from(schema.submissions).where(eq(schema.submissions.id, body.data.id)).get()).toMatchObject({ extensionId: "ext-jitsi", authorId: "author-alice" });
  }

  it("goes to the extension the folder's manifest.json names, whatever other extension trusts the same folder", async () => {
    // The other row accepts any environment.
    otherRow();
    await expectAlices(await publish(await aliceToken("jitsi-meet@4.1.0", sha(51)), "jitsi-meet"));
    // The other row names the same environment as alice's.
    db.update(schema.publishers).set({ environment: "release" }).where(eq(schema.publishers.id, "pub-other")).run();
    await expectAlices(await publish(await aliceToken("jitsi-meet@4.2.0", sha(52)), "jitsi-meet"));
  });

  it("takes the row naming the run's environment when the extension also has one without", async () => {
    db.update(schema.publishers).set({ lastUsedAt: null }).where(eq(schema.publishers.id, "pub-alice")).run();
    db.insert(schema.publishers).values({
      id: "pub-alice-any", extensionId: "ext-jitsi", repository: "alice/plugins", repositoryId: "111", repositoryOwnerId: "222",
      workflowPath: ".github/workflows/publish.yml", environment: null, subpath: "jitsi-meet", allowedRefs: "tags", createdBy: "author-alice",
    }).run();
    await expectAlices(await publish(await aliceToken("jitsi-meet@4.3.0", sha(53)), "jitsi-meet"));
    const used = (id: string) => db.select().from(schema.publishers).where(eq(schema.publishers.id, id)).get()!.lastUsedAt;
    expect(used("pub-alice")).not.toBeNull();
    expect(used("pub-alice-any")).toBeNull();
    // A run without an environment goes through the row that accepts any.
    await expectAlices(await publish(await aliceToken("jitsi-meet@4.4.0", sha(54), { environment: undefined }), "jitsi-meet"));
    expect(used("pub-alice-any")).not.toBeNull();
  });

  it("doesn't count a row of a suspended extension or of an account banned since", async () => {
    otherRow();
    db.insert(schema.publishers).values({
      id: "pub-spare", extensionId: "ext-squat", repository: "alice/plugins", repositoryId: "111", repositoryOwnerId: "222",
      workflowPath: ".github/workflows/publish.yml", environment: null, subpath: "spare", allowedRefs: "tags", createdBy: "squatter",
    }).run();
    const squatted = () => db.select().from(schema.submissions).where(eq(schema.submissions.extensionId, "ext-squat")).all();

    db.update(schema.extensions).set({ status: "suspended" }).where(eq(schema.extensions.id, "ext-squat")).run();
    await expectAlices(await publish(await aliceToken("jitsi-meet@4.5.0", sha(55)), "jitsi-meet"));
    expect((await publish(await aliceToken("spare@1.0.0", sha(58)), "spare")).status).toBe(403);

    db.update(schema.extensions).set({ status: "pending" }).where(eq(schema.extensions.id, "ext-squat")).run();
    db.update(schema.authors).set({ bannedAt: new Date() }).where(eq(schema.authors.id, "squatter")).run();
    await expectAlices(await publish(await aliceToken("jitsi-meet@4.6.0", sha(56)), "jitsi-meet"));
    expect((await publish(await aliceToken("spare@1.0.0", sha(58)), "spare")).status).toBe(403);
    expect(squatted()).toEqual([]);
  });

  it("doesn't let a maintainer add a publisher for a repository by first pointing the source at it", async () => {
    await signIn("squatter");
    // Source changes still apply at once.
    expect((await send("PATCH", "/extensions/squatted", { repository: "alice/plugins", subpath: "jitsi-meet" })).status).toBe(200);
    const r = await post("/extensions/squatted/publishers", { repository: "alice/plugins", workflowPath: ".github/workflows/publish.yml", subpath: "jitsi-meet" });
    expect(r.status).toBe(403);
    signOut();
    await expectAlices(await publish(await aliceToken("jitsi-meet@4.7.0", sha(57)), "jitsi-meet"));
  });
});
