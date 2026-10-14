// The session-authenticated parts of /api/v2: dashboards, review, moderation.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { seed } from "./fixtures/seed";
import { req, BASE } from "./helpers/http";
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
const { createToken } = await import("@/lib/auth/tokens");
const { currentUser } = await import("@/lib/auth/session");

const dispatch = router(v2Routes);
const call = async (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await dispatch(method)(req(`/api/v2${path}`, { method, body, headers: { origin: new URL(BASE).origin, ...headers } }));
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  await seed();
  await db.insert(schema.authors).values([
    { id: "staff", githubId: 3001, githubLogin: "staff", displayName: "Staff", role: "admin" },
    { id: "rev", githubId: 3002, githubLogin: "rev", displayName: "Rev", role: "reviewer" },
    { id: "carol", githubId: 3003, githubLogin: "carol", displayName: "Carol" },
  ]);
});

beforeEach(() => {
  signOut();
  resetFakes();
  db.delete(schema.rateLimits).run();
});

describe("access", () => {
  it("asks for a sign-in on author and admin endpoints", async () => {
    expect((await call("GET", "/me")).status).toBe(401);
    expect((await call("GET", "/admin/submissions")).status).toBe(401);
  });

  it("keeps authors out of staff endpoints and reviewers out of admin ones", async () => {
    await signIn("author-alice");
    expect((await call("GET", "/admin/submissions")).status).toBe(403);
    await signIn("rev");
    expect((await call("GET", "/admin/submissions")).status).toBe(200);
    expect((await call("GET", "/admin/authors")).status).toBe(403);
  });

  it("refuses cookie-authenticated writes from another site", async () => {
    await signIn("author-alice");
    expect((await call("PATCH", "/me", { notifyEmail: false }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call("PATCH", "/me", { notifyEmail: false })).status).toBe(200);
  });

  it("hides other people's extensions from their manage view", async () => {
    await signIn("author-bob");
    expect((await call("GET", "/extensions/jitsi-meet/manage")).status).toBe(404);
    await signIn("author-alice");
    expect((await call("GET", "/extensions/jitsi-meet/manage")).status).toBe(200);
  });
});

describe("public text waits for review", () => {
  it("keeps the old description until a reviewer approves the change", async () => {
    await signIn("author-alice");
    const r = await call("PATCH", "/extensions/jitsi-meet", { description: "New and improved" });
    expect(r.body.data.waitingForReview).toEqual(["description"]);
    const desc = () => db.select().from(schema.extensions).where(eq(schema.extensions.slug, "jitsi-meet")).get()!.description;
    expect(desc()).toBe("Start a Jitsi call from a message");

    await signIn("rev");
    const pending = (await call("GET", "/admin/text-changes")).body.data;
    expect(pending).toEqual([expect.objectContaining({ slug: "jitsi-meet", field: "description", newValue: "New and improved" })]);
    expect((await call("POST", `/admin/text-changes/${pending[0].id}/reject`, {})).status).toBe(400);
    expect((await call("POST", `/admin/text-changes/${pending[0].id}/approve`, {})).status).toBe(200);
    expect(desc()).toBe("New and improved");
    expect((await call("POST", `/admin/text-changes/${pending[0].id}/approve`, {})).status).toBe(409);
  });

  it("changes the source at once, checking the repository exists and is public", async () => {
    addRepo("alice/new-home", { commits: {} });
    await signIn("author-alice");
    expect((await call("PATCH", "/extensions/jitsi-meet", { repository: "alice/missing" })).status).toBe(400);
    expect((await call("PATCH", "/extensions/jitsi-meet", { repository: "alice/new-home", subpath: "jitsi" })).status).toBe(200);
    expect(db.select().from(schema.extensions).where(eq(schema.extensions.slug, "jitsi-meet")).get()).toMatchObject({ githubRepo: "alice/new-home", subpath: "jitsi" });
  });
});

describe("members and publishers", () => {
  it("lets owners add maintainers and refuses to remove the last owner", async () => {
    await signIn("author-alice");
    expect((await call("POST", "/extensions/jitsi-meet/members", { login: "carol" })).status).toBe(201);
    expect((await call("DELETE", "/extensions/jitsi-meet/members/author-alice")).status).toBe(409);
    await signIn("carol");
    expect((await call("POST", "/extensions/jitsi-meet/members", { login: "author-bob" })).status).toBe(403);
    expect((await call("GET", "/extensions/jitsi-meet/manage")).status).toBe(200);
  });

  it("stores trusted publishers by the repository's numeric ids", async () => {
    addRepo("alice/plugins", { info: { id: "111", ownerId: "222" } as never, commits: {} });
    await signIn("author-alice");
    expect((await call("POST", "/extensions/jitsi-meet/publishers", { repository: "alice/plugins", workflowPath: "publish.yml" })).status).toBe(400);
    const r = await call("POST", "/extensions/jitsi-meet/publishers", { repository: "alice/plugins", workflowPath: ".github/workflows/publish.yml", environment: "release", subpath: "jitsi-meet" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ repositoryId: "111", repositoryOwnerId: "222", subpath: "jitsi-meet", allowedRefs: "tags" });
  });
});

describe("bans", () => {
  it("end sessions, revoke tokens and disable publishers at once", async () => {
    const { row } = await createToken({ authorId: "author-bob", name: "x", extensionIds: ["ext-nord"], scopes: ["publish"], days: 30 }, { kind: "author", id: "author-bob" });
    await signIn("author-bob");
    expect((await currentUser())?.id).toBe("author-bob");
    await signIn("staff");
    expect((await call("POST", "/admin/authors/author-bob", { action: "ban" })).status).toBe(400);
    expect((await call("POST", "/admin/authors/author-bob", { action: "ban", reason: "malware" })).status).toBe(200);
    expect(db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, row.id)).get()!.revokedAt).not.toBeNull();
    await signIn("author-bob");
    expect(await currentUser()).toBeNull();
    expect((await call("GET", "/me")).status).toBe(401);
    await signIn("staff");
    await call("POST", "/admin/authors/author-bob", { action: "unban" });
  });

  it("only lets super admins change roles", async () => {
    await signIn("staff");
    expect((await call("POST", "/admin/authors/carol", { action: "role", role: "admin" })).status).toBe(403);
  });
});

describe("ratings and reports", () => {
  it("lets signed-in accounts rate others' extensions once, not their own", async () => {
    await signIn("author-alice");
    expect((await call("POST", "/extensions/jitsi-meet/rating", { stars: 5 })).status).toBe(403);
    await signIn("carol");
    expect((await call("POST", "/extensions/nord/rating", { stars: 4, body: "Nice" })).status).toBe(200);
    expect((await call("POST", "/extensions/nord/rating", { stars: 2 })).status).toBe(200);
    expect((await call("GET", "/extensions/nord/ratings")).body.data.summary).toEqual({ average: 2, count: 1 });
    signOut();
    expect((await call("POST", "/extensions/nord/rating", { stars: 5 })).status).toBe(401);
  });

  it("takes abuse reports from anyone, folds repeats and limits floods", async () => {
    const send = (details: string, extra: Record<string, unknown> = {}) => call("POST", "/extensions/nord/reports", { reason: "privacy", details, ...extra }, { "x-real-ip": "192.0.2.77" });
    expect((await send("short")).status).toBe(400);
    expect((await send("Sends my contacts somewhere")).status).toBe(201);
    expect((await send("Sends my contacts somewhere, again")).status).toBe(201);
    const rows = db.select().from(schema.reports).where(eq(schema.reports.reason, "privacy")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].duplicates).toBe(1);
    expect((await send("bot", { website: "spam" })).status).toBe(201);
    for (let i = 0; i < 3; i++) await send(`Another report number ${i}`);
    expect((await send("One report too many here")).status).toBe(429);
  });
});
