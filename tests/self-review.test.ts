// Approval publishes a signed bundle to every webmail, so the person who decides
// on a submission is not its author or a maintainer of the extension. A super admin
// may still approve their own work by saying so, and the audit log records it.
// The same holds for text changes (descriptions, changelogs).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { req, BASE } from "./helpers/http";
import { signIn, signOut } from "./helpers/session";
import { addRepo, fakeSource, plainPlugin, resetFakes, sha } from "./helpers/fake-source";

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  source: () => fakeSource,
}));

const { db } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const { router } = await import("@/lib/api/router");
const { v2Routes } = await import("@/lib/api/v2");
const { createSubmission } = await import("@/lib/publishing/submit");
const { runOnce } = await import("@/lib/worker");

const dispatch = router(v2Routes);
const send = async (path: string, body: Record<string, unknown> = {}) => {
  const res = await dispatch("POST")(req(`/api/v2${path}`, { method: "POST", body, headers: { origin: new URL(BASE).origin } }));
  return res.status;
};
// The page sends the hash of the bundle it shows with every approval (tests/approval-pins-bundle.test.ts).
const approve = (id: string, body: Record<string, unknown> = {}) => send(`/admin/submissions/${id}/approve`, {
  artifactSha256: db.select().from(schema.submissions).where(eq(schema.submissions.id, id)).get()!.artifactSha256, ...body,
});
const statusOf = (id: string) => db.select().from(schema.submissions).where(eq(schema.submissions.id, id)).get()!.status;

let commitNo = 60;
async function submitAs(authorId: string, slug: string, via: "web" | "oidc" = "web") {
  const commit = sha(commitNo++);
  addRepo(`${authorId}/${slug}`, { refs: { "v1.0.0": commit }, commits: { [commit]: plainPlugin(slug, "1.0.0") } });
  const { submission } = await createSubmission({ authorId, actor: via === "oidc" ? { kind: "oidc", id: `${authorId}/${slug}` } : { kind: "author", id: authorId }, via, allowCreate: true, host: "github.com", repo: `${authorId}/${slug}`, ref: "v1.0.0", subpath: "", dryRun: false });
  while (await runOnce()) { /* build */ }
  expect(statusOf(submission.id)).toBe("awaiting_review");
  return submission.id;
}
const extensionId = (slug: string) => db.select().from(schema.extensions).where(eq(schema.extensions.slug, slug)).get()!.id;

beforeAll(async () => {
  await db.insert(schema.authors).values([
    { id: "rev", githubId: 8001, githubLogin: "rev", displayName: "Rev", role: "reviewer" },
    { id: "rev2", githubId: 8002, githubLogin: "rev2", displayName: "Rev Two", role: "reviewer" },
    { id: "pal", githubId: 8003, githubLogin: "pal", displayName: "Pal" },
    { id: "boss", githubId: 8004, githubLogin: "boss", displayName: "Boss", role: "super_admin" },
    { id: "adm", githubId: 8005, githubLogin: "adm", displayName: "Adm", role: "admin" },
    { id: "org-acme", githubId: 8100, githubLogin: "acme", displayName: "Acme", kind: "org" },
  ]);
});

beforeEach(() => {
  signOut();
  resetFakes();
  db.delete(schema.rateLimits).run();
});

describe("approving your own submission", () => {
  it("is refused for the reviewer who submitted it; another reviewer can approve", async () => {
    const id = await submitAs("rev", "own-plugin");
    await signIn("rev");
    expect(await approve(id)).toBe(403);
    expect(await approve(id, { selfReview: true })).toBe(403);
    expect(statusOf(id)).toBe("awaiting_review");
    await signIn("rev2");
    expect(await approve(id)).toBe(200);
  });

  it("is refused for a reviewer who maintains the extension, whoever submitted", async () => {
    const id = await submitAs("pal", "pals-plugin");
    await db.insert(schema.extensionMembers).values({ extensionId: extensionId("pals-plugin"), authorId: "rev", role: "maintainer", addedBy: "pal" });
    await signIn("rev");
    expect(await approve(id)).toBe(403);
    expect(statusOf(id)).toBe("awaiting_review");
  });

  it("is refused for a reviewer who is in the organization that owns the extension", async () => {
    const id = await submitAs("pal", "acme-plugin");
    db.update(schema.extensions).set({ authorId: "org-acme" }).where(eq(schema.extensions.slug, "acme-plugin")).run();
    await db.insert(schema.orgMembers).values({ orgId: "org-acme", authorId: "rev", role: "member" });
    await signIn("rev");
    expect(await approve(id)).toBe(403);
    expect(statusOf(id)).toBe("awaiting_review");
  });

  it("is refused for a maintainer when the submission came from GitHub Actions under someone else's name", async () => {
    const id = await submitAs("pal", "ci-plugin", "oidc");
    expect(db.select().from(schema.submissions).where(eq(schema.submissions.id, id)).get()).toMatchObject({ authorId: "pal", submittedVia: "oidc" });
    await db.insert(schema.extensionMembers).values({ extensionId: extensionId("ci-plugin"), authorId: "rev", role: "owner", addedBy: "pal" });
    await signIn("rev");
    expect(await approve(id)).toBe(403);
    await signIn("rev2");
    expect(await approve(id)).toBe(200);
  });

  it("is refused for an admin even with the flag", async () => {
    const id = await submitAs("adm", "admins-plugin");
    await signIn("adm");
    expect(await approve(id, { selfReview: true })).toBe(403);
    expect(statusOf(id)).toBe("awaiting_review");
  });

  it("needs the flag from a super admin, and the audit log records it", async () => {
    const id = await submitAs("boss", "boss-plugin");
    await signIn("boss");
    expect(await approve(id)).toBe(403);
    expect(statusOf(id)).toBe("awaiting_review");
    expect(await approve(id, { selfReview: true })).toBe(200);
    expect(statusOf(id)).toBe("publishing");
    const entry = db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "submission.approve"), eq(schema.auditLog.targetId, id))).get()!;
    expect(entry.details).toMatchObject({ selfReview: true });
  });

  it("records no self review when someone else approves", async () => {
    const id = await submitAs("pal", "plain-plugin");
    await signIn("rev");
    expect(await approve(id)).toBe(200);
    const entry = db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "submission.approve"), eq(schema.auditLog.targetId, id))).get()!;
    expect(entry.details).toMatchObject({ selfReview: false });
  });
});

describe("approving your own text change", () => {
  async function propose(slug: string, by: string, text: string) {
    await signIn(by);
    const res = await dispatch("PATCH")(req(`/api/v2/extensions/${slug}`, { method: "PATCH", body: { description: text }, headers: { origin: new URL(BASE).origin } }));
    expect(res.status).toBe(200);
    return db.select().from(schema.textChanges).where(and(eq(schema.textChanges.extensionId, extensionId(slug)), eq(schema.textChanges.status, "pending"))).get()!.id;
  }
  const textStatus = (id: string) => db.select().from(schema.textChanges).where(eq(schema.textChanges.id, id)).get()!.status;

  it("is refused for the reviewer who proposed it; another reviewer can approve", async () => {
    await submitAs("rev", "rev-texts");
    const tc = await propose("rev-texts", "rev", "Written by the reviewer");
    expect(await send(`/admin/text-changes/${tc}/approve`)).toBe(403);
    expect(textStatus(tc)).toBe("pending");
    await signIn("rev2");
    expect(await send(`/admin/text-changes/${tc}/approve`)).toBe(200);
    expect(textStatus(tc)).toBe("approved");
  });

  it("is refused for a reviewer who maintains the extension", async () => {
    await submitAs("pal", "pal-texts");
    await db.insert(schema.extensionMembers).values({ extensionId: extensionId("pal-texts"), authorId: "rev", role: "maintainer", addedBy: "pal" });
    const tc = await propose("pal-texts", "pal", "Written by the owner");
    await signIn("rev");
    expect(await send(`/admin/text-changes/${tc}/approve`)).toBe(403);
    expect(textStatus(tc)).toBe("pending");
  });

  it("needs the flag from a super admin", async () => {
    await submitAs("boss", "boss-texts");
    const tc = await propose("boss-texts", "boss", "Written by the super admin");
    expect(await send(`/admin/text-changes/${tc}/approve`)).toBe(403);
    expect(await send(`/admin/text-changes/${tc}/approve`, { selfReview: true })).toBe(200);
    expect(textStatus(tc)).toBe("approved");
    expect(db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "text_change.self_review"), eq(schema.auditLog.targetId, tc))).get()).toBeTruthy();
  });
});
