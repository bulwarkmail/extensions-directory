// POST /api/v1/submissions: who may submit what.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { seed } from "../fixtures/seed";
import { req } from "../helpers/http";

const session: { authorId?: string } = {};
vi.mock("@/lib/auth", () => ({
  requireAuthorSession: async () => {
    if (!session.authorId) throw new Error("Unauthorized");
    return session;
  },
}));

let manifest: Record<string, unknown> = {};
vi.mock("@/lib/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github")>()),
  verifyRepoIsPublic: async () => true,
  getDefaultBranch: async () => "main",
  resolveRefSha: async () => "a".repeat(40),
  statRepoPath: async () => "directory",
  fetchRepoFile: async () => JSON.stringify(manifest),
  downloadRefArchive: async () => {
    const zip = new JSZip();
    zip.file("repo-aaaa/manifest.json", JSON.stringify(manifest));
    if (manifest.type === "theme") zip.file("repo-aaaa/theme.css", ":root { --x: 1 }\n");
    else zip.file("repo-aaaa/index.js", "export default {}\n");
    return zip.generateAsync({ type: "nodebuffer" });
  },
}));

const { POST } = await import("@/app/api/v1/submissions/route");
const { db } = await import("@/lib/db/client");
const { authors, submissions } = await import("@/lib/db/schema");

const plugin = (id: string, version: string) => ({
  id, name: id, version, author: "x", description: "d", type: "hook", entrypoint: "index.js",
});
const submit = () => POST(req("/api/v1/submissions", { method: "POST", body: { repoUrl: "https://github.com/someone/repo" } }));

beforeAll(seed);
beforeEach(async () => {
  await db.delete(submissions).where(eq(submissions.authorId, "author-bob"));
  await db.update(authors).set({ banned: false });
});

describe("POST /api/v1/submissions", () => {
  it("refuses a version of an extension owned by someone else", async () => {
    session.authorId = "author-bob";
    manifest = plugin("jitsi-meet", "5.0.0");
    const res = await submit();
    expect(res.status).toBe(403);
    expect(await db.select().from(submissions).where(eq(submissions.authorId, "author-bob"))).toHaveLength(0);
  });

  it("accepts a version of the author's own extension", async () => {
    session.authorId = "author-bob";
    manifest = { id: "nord", name: "Nord", version: "2.1.0", author: "Bob", description: "Arctic", type: "theme" };
    const res = await submit();    expect(res.status).toBe(201);
  });

  it("accepts a brand-new extension", async () => {
    session.authorId = "author-bob";
    manifest = plugin("brand-new", "1.0.0");
    const res = await submit();
    expect(res.status).toBe(201);
  });

  it("refuses a banned author", async () => {
    session.authorId = "author-bob";
    await db.update(authors).set({ banned: true }).where(eq(authors.id, "author-bob"));
    manifest = plugin("another-new", "1.0.0");
    const res = await submit();
    expect(res.status).toBe(403);
    expect(await db.select().from(submissions).where(eq(submissions.authorId, "author-bob"))).toHaveLength(0);
  });
});
