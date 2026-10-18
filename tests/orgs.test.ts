// Organization owners: an org never signs in, its members manage what it
// owns, staff transfer extensions to it, and the public sees the org.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { seed } from "./fixtures/seed";
import { params, req, BASE } from "./helpers/http";
import { signIn, signOut } from "./helpers/session";
import { addRepo, fakeSource, resetFakes } from "./helpers/fake-source";

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  source: () => fakeSource,
}));

const { db } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const { router } = await import("@/lib/api/router");
const { v2Routes } = await import("@/lib/api/v2");
const { currentUser } = await import("@/lib/auth/session");
const { authorForSignIn } = await import("@/lib/auth/sign-in");
const { assertActorAllowed } = await import("@/lib/auth/guard");
const { createToken } = await import("@/lib/auth/tokens");
const { queueNotification } = await import("@/lib/notify");
const { housekeeping } = await import("@/lib/worker");
const { getExtensions } = await import("@/lib/db/queries");
const v1Detail = await import("@/app/api/v1/extension/[slug]/route");

const ORG = "e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4";
const dispatch = router(v2Routes);
const call = async (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) => {
  const res = await dispatch(method)(req(`/api/v2${path}`, { method, body, headers: { origin: new URL(BASE).origin } }));
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  await seed();
  await db.insert(schema.authors).values([
    { id: "staff", githubId: 3001, githubLogin: "staff", displayName: "Staff", role: "admin" },
    { id: "rev", githubId: 3002, githubLogin: "rev", displayName: "Rev", role: "reviewer" },
    { id: "olivia", githubId: 3003, githubLogin: "olivia", displayName: "Olivia" },
    { id: "max", githubId: 3004, githubLogin: "max", displayName: "Max" },
    { id: "erin", githubId: 3005, githubLogin: "erin", displayName: "Erin" },
  ]);
  await db.insert(schema.orgMembers).values([
    { orgId: ORG, authorId: "olivia", role: "owner" },
    { orgId: ORG, authorId: "max", role: "member" },
  ]);
  await db.insert(schema.extensions).values({
    id: "ext-org", slug: "org-thing", name: "Org thing", type: "plugin", pluginType: "hook", authorId: ORG, description: "Official",
    githubRepo: "bulwarkmail/plugins", subpath: "org-thing", status: "pending", reservedAt: new Date(),
  });
});

beforeEach(() => {
  signOut();
  resetFakes();
  db.delete(schema.rateLimits).run();
  addRepo("bulwarkmail/plugins", { info: { id: "1191052237", ownerId: "266882946" } as never, commits: {} });
});

describe("an organization", () => {
  it("exists after the migrations, as a verified org", () => {
    expect(db.select().from(schema.authors).where(eq(schema.authors.id, ORG)).get()).toMatchObject({
      githubId: 266882946, githubLogin: "bulwarkmail", displayName: "Bulwark", kind: "org", verified: true,
    });
  });

  it("can't sign in, and its row isn't touched by a sign-in with its GitHub id", async () => {
    const profile = { id: 266882946, login: "bulwarkmail", name: "Hijack", avatarUrl: "x", bio: null, blog: null, email: "x@example.com" };
    await expect(authorForSignIn(profile)).rejects.toMatchObject({ status: 403, code: "org_sign_in" });
    expect(db.select().from(schema.authors).where(eq(schema.authors.githubId, 266882946)).all()).toEqual([
      expect.objectContaining({ id: ORG, displayName: "Bulwark", email: null }),
    ]);
  });

  it("gets no session even with a cookie naming it", async () => {
    await signIn(ORG);
    expect(await currentUser()).toBeNull();
    expect((await call("GET", "/me")).status).toBe(401);
  });

  it("can't act itself, and can't be added as a member", async () => {
    await expect(assertActorAllowed(ORG)).rejects.toThrow(/organization/);
    await signIn("author-alice");
    expect((await call("POST", "/extensions/jitsi-meet/members", { login: "bulwarkmail" })).status).toBe(404);
  });

  it("signs in people as before", async () => {
    const a = await authorForSignIn({ id: 4242, login: "newbie", name: null, avatarUrl: "x", bio: null, blog: null, email: null });
    expect(a).toMatchObject({ githubLogin: "newbie", kind: "user" });
  });
});

describe("org members", () => {
  it("manage the org's extensions: owners as owners, members as maintainers", async () => {
    await signIn("max");
    expect((await call("GET", "/extensions/org-thing/manage")).status).toBe(200);
    const pub = await call("POST", "/extensions/org-thing/publishers", { repository: "bulwarkmail/plugins", workflowPath: ".github/workflows/publish.yml", environment: "extensions", subpath: "org-thing" });
    expect(pub.status).toBe(201);
    expect(pub.body.data).toMatchObject({ repositoryId: "1191052237", repositoryOwnerId: "266882946", createdBy: "max" });
    expect((await call("POST", "/extensions/org-thing/members", { login: "erin" })).status).toBe(403);

    await signIn("olivia");
    expect((await call("POST", "/extensions/org-thing/members", { login: "erin" })).status).toBe(201);
    expect((await call("DELETE", "/extensions/org-thing/members/erin")).status).toBe(200);
  });

  it("see the org's extensions in their list", async () => {
    await signIn("max");
    const mine = (await call("GET", "/me/extensions")).body.data;
    expect(mine).toEqual([expect.objectContaining({ slug: "org-thing", role: "maintainer", organization: "bulwarkmail" })]);
    expect((await call("GET", "/me")).body.data.organizations).toEqual([{ login: "bulwarkmail", name: "Bulwark", role: "member" }]);
  });

  it("may scope API tokens to the org's extensions", async () => {
    const { row } = await createToken({ authorId: "max", name: "ci", extensionIds: ["ext-org"], scopes: ["publish"], days: 30 }, { kind: "author", id: "max" });
    expect(row.authorId).toBe("max");
    await expect(createToken({ authorId: "erin", name: "ci", extensionIds: ["ext-org"], scopes: ["publish"], days: 30 }, { kind: "author", id: "erin" })).rejects.toMatchObject({ status: 403 });
  });

  it("reserve new names for the org", async () => {
    await signIn("max");
    const r = await call("POST", "/extensions", { slug: "org-new", repository: "bulwarkmail/plugins", subpath: "org-new", owner: "bulwarkmail" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ slug: "org-new", owner: "bulwarkmail" });
    const ext = db.select().from(schema.extensions).where(eq(schema.extensions.slug, "org-new")).get()!;
    expect(ext).toMatchObject({ authorId: ORG, status: "pending", subpath: "org-new" });
    // Access comes from the organization, so leaving it ends it.
    expect(db.select().from(schema.extensionMembers).where(eq(schema.extensionMembers.extensionId, ext.id)).all()).toEqual([]);
    expect((await call("GET", "/extensions/org-new/manage")).status).toBe(200);
  });

  it("let owners manage the org's members; members may only leave", async () => {
    await signIn("max");
    expect((await call("POST", "/orgs/bulwarkmail/members", { login: "erin" })).status).toBe(403);
    await signIn("olivia");
    expect((await call("POST", "/orgs/bulwarkmail/members", { login: "erin" })).status).toBe(201);
    expect((await call("DELETE", "/orgs/bulwarkmail/members/olivia")).status).toBe(409);
    await signIn("erin");
    expect((await call("GET", "/extensions/org-thing/manage")).status).toBe(200);
    expect((await call("DELETE", "/orgs/bulwarkmail/members/erin")).status).toBe(200);
    expect((await call("GET", "/extensions/org-thing/manage")).status).toBe(404);
  });
});

describe("people outside the org", () => {
  it("can't manage, configure or reserve for it", async () => {
    await signIn("erin");
    expect((await call("GET", "/extensions/org-thing/manage")).status).toBe(404);
    expect((await call("POST", "/extensions/org-thing/publishers", { repository: "bulwarkmail/plugins", workflowPath: ".github/workflows/publish.yml", subpath: "org-thing" })).status).toBe(404);
    expect((await call("POST", "/extensions", { slug: "org-sneak", repository: "bulwarkmail/plugins", owner: "bulwarkmail" })).status).toBe(403);
    // Naming a person as owner isn't a way around it either.
    expect((await call("POST", "/extensions", { slug: "org-sneak", repository: "bulwarkmail/plugins", owner: "alice" })).status).toBe(403);
    expect((await call("GET", "/orgs/bulwarkmail/members")).status).toBe(404);
    expect(db.select().from(schema.extensions).where(eq(schema.extensions.slug, "org-sneak")).get()).toBeUndefined();
  });
});

describe("transfer", () => {
  it("is for admins only", async () => {
    await signIn("rev");
    expect((await call("POST", "/admin/extensions/nord", { action: "transfer", to: "bulwarkmail" })).status).toBe(403);
    await signIn("author-bob");
    expect((await call("POST", "/admin/extensions/nord", { action: "transfer", to: "bulwarkmail" })).status).toBe(403);
  });

  it("moves an extension to the org, keeps the old owner's access and logs it", async () => {
    await signIn("staff");
    expect((await call("POST", "/admin/extensions/nord", { action: "transfer", to: "nobody-here" })).status).toBe(404);
    expect((await call("POST", "/admin/extensions/nord", { action: "transfer", to: "bulwarkmail" })).status).toBe(200);
    expect(db.select().from(schema.extensions).where(eq(schema.extensions.slug, "nord")).get()!.authorId).toBe(ORG);
    expect(db.select().from(schema.extensionMembers).where(eq(schema.extensionMembers.extensionId, "ext-nord")).all()).toEqual([
      expect.objectContaining({ authorId: "author-bob", role: "owner" }),
    ]);
    expect(db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "extension.transfer"), eq(schema.auditLog.targetId, "ext-nord"))).get()).toMatchObject({
      actorKind: "admin", actorId: "staff", details: { slug: "nord", from: "bob", to: "bulwarkmail", toKind: "org" },
    });
    await signIn("author-bob");
    expect((await call("GET", "/extensions/nord/manage")).status).toBe(200);
    await signIn("max");
    expect((await call("GET", "/extensions/nord/manage")).status).toBe(200);
  });

  it("makes a person who receives an extension its owner", async () => {
    await signIn("staff");
    expect((await call("POST", "/admin/extensions/draft-thing", { action: "transfer", to: "erin" })).status).toBe(200);
    expect(db.select().from(schema.extensionMembers).where(and(eq(schema.extensionMembers.extensionId, "ext-draft"), eq(schema.extensionMembers.authorId, "erin"))).get()).toMatchObject({ role: "owner" });
  });
});

describe("in public", () => {
  it("shows the organization as the author", async () => {
    await db.update(schema.extensions).set({ authorId: ORG }).where(eq(schema.extensions.id, "ext-nord"));
    const v2 = await call("GET", "/extensions/nord");
    expect(v2.body.data.author).toMatchObject({ login: "bulwarkmail", name: "Bulwark", verified: true, organization: true, url: "https://extensions.test/author/bulwarkmail" });
    const v1 = await (await v1Detail.GET(req("/api/v1/extension/nord"), params({ slug: "nord" }))).json();
    expect(v1.data.author).toMatchObject({ githubLogin: "bulwarkmail", displayName: "Bulwark", verified: true, email: null });
    expect(Object.keys(v1.data.author)).toEqual(["id", "githubId", "githubLogin", "displayName", "avatarUrl", "email", "bio", "website", "verified", "banned", "createdAt", "updatedAt"]);
  });

  it("lists the organization's extensions on its author page", async () => {
    expect((await getExtensions({ authorLogin: "bulwarkmail" })).data.map((e) => e.slug)).toEqual(["nord"]);
    expect((await call("GET", "/extensions?author=bulwarkmail")).body.data.map((e: { slug: string }) => e.slug)).toEqual(["nord"]);
  });
});

describe("housekeeping", () => {
  it("sends the org's mail to its owners", async () => {
    await queueNotification(ORG, "reservation.expiring", { slug: "org-thing" });
    expect(db.select().from(schema.notifications).where(eq(schema.notifications.kind, "reservation.expiring")).all().map((n) => n.authorId)).toEqual(["olivia"]);
  });

  it("keeps the org's reservations past 90 days and releases a person's", async () => {
    const old = new Date(Date.now() - 100 * 86_400_000);
    await db.update(schema.extensions).set({ reservedAt: old }).where(eq(schema.extensions.id, "ext-org"));
    await db.insert(schema.extensions).values({ id: "ext-stale", slug: "stale", name: "Stale", type: "plugin", authorId: "erin", description: "x", githubRepo: "erin/stale", status: "pending", reservedAt: old });
    await housekeeping();
    expect(db.select().from(schema.extensions).where(eq(schema.extensions.id, "ext-org")).get()).toBeDefined();
    expect(db.select().from(schema.extensions).where(eq(schema.extensions.id, "ext-stale")).get()).toBeUndefined();
  });
});
