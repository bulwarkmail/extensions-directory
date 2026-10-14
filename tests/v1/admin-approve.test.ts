// POST /api/v1/admin/submissions approve: never publish under someone else's
// extension, and never for a banned author.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { seed } from "../fixtures/seed";
import { req } from "../helpers/http";

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => ({ adminId: "admin-1" }),
}));
const build = vi.fn(async () => ({ path: "bundles/x/1/x.zip", sha256: "0".repeat(64), size: 1, source: "flat", note: "" }));
vi.mock("@/lib/manifest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manifest")>()),
  buildAndStoreBundle: build,
}));
vi.mock("@/lib/media", () => ({
  extractAndStoreMedia: async () => ({ warnings: [] }),
}));
vi.mock("@/lib/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github")>()),
  getRepoLicense: async () => "MIT",
}));

const { POST } = await import("@/app/api/v1/admin/submissions/route");
const { db } = await import("@/lib/db/client");
const { authors, submissions, extensions } = await import("@/lib/db/schema");

const manifest = (id: string) => ({ id, name: id, version: "9.0.0", author: "x", description: "d", type: "hook", entrypoint: "index.js" });
const approve = (submissionId: string) =>
  POST(req("/api/v1/admin/submissions", { method: "POST", body: { submissionId, action: "approve" } }));

beforeAll(async () => {
  await seed();
  await db.insert(submissions).values([
    // Made before the submit-time check existed: bob targeting alice's slug.
    { id: "sub-hijack", extensionId: "ext-jitsi", authorId: "author-bob", type: "new_version", githubRepo: "bob/evil", githubTag: "main", manifestSnapshot: manifest("jitsi-meet"), status: "review" },
    { id: "sub-hijack-slug", extensionId: null, authorId: "author-bob", type: "new_extension", githubRepo: "bob/evil", githubTag: "main", manifestSnapshot: manifest("jitsi-meet"), status: "review" },
    { id: "sub-banned", extensionId: null, authorId: "author-bob", type: "new_extension", githubRepo: "bob/new", githubTag: "main", manifestSnapshot: manifest("bobs-new"), status: "review" },
    { id: "sub-ok", extensionId: null, authorId: "author-bob", type: "new_extension", githubRepo: "bob/fine", githubTag: "main", manifestSnapshot: manifest("bobs-fine"), status: "review" },
  ]);
});

describe("approve", () => {
  it.each(["sub-hijack", "sub-hijack-slug"])("refuses %s, which targets another author's extension", async (id) => {
    const res = await approve(id);
    expect(res.status).toBe(409);
    expect(build).not.toHaveBeenCalled();
    const [ext] = await db.select().from(extensions).where(eq(extensions.slug, "jitsi-meet"));
    expect(ext.githubRepo).toBe("alice/plugins");
  });

  it("refuses a banned author's submission", async () => {
    await db.update(authors).set({ banned: true }).where(eq(authors.id, "author-bob"));
    const res = await approve("sub-banned");
    await db.update(authors).set({ banned: false }).where(eq(authors.id, "author-bob"));
    expect(res.status).toBe(409);
    expect(build).not.toHaveBeenCalled();
  });

  it("approves the author's own new extension", async () => {
    const res = await approve("sub-ok");
    expect(res.status).toBe(200);
    expect(build).toHaveBeenCalledTimes(1);
  });
});
