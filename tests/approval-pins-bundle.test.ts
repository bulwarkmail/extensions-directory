// An approval names the bundle the reviewer looked at: the review page sends the
// SHA-256 of the staged bundle it was built from, and the server refuses the
// approval when the submission was built again with other bytes since. The API
// route requires the hash, for every reviewer, a super admin's own approval
// included.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
const ReviewPage = (await import("@/app/admin/submissions/[id]/page")).default;

const dispatch = router(v2Routes);
const row = (id: string) => db.select().from(schema.submissions).where(eq(schema.submissions.id, id)).get()!;
const approve = async (id: string, body: Record<string, unknown>) => {
  const res = await dispatch("POST")(req(`/api/v2/admin/submissions/${id}/approve`, { method: "POST", body, headers: { origin: new URL(BASE).origin } }));
  return { status: res.status, body: await res.json() };
};
/** Stands in for a rebuild that produced other bytes after the reviewer opened the page. */
const rebuiltElsewhere = (id: string) => db.update(schema.submissions).set({ artifactSha256: "e".repeat(64) }).where(eq(schema.submissions.id, id)).run();

let commitNo = 400;
async function submitAs(authorId: string, slug: string) {
  const commit = sha(commitNo++);
  addRepo(`${authorId}/${slug}`, { refs: { "v1.0.0": commit }, commits: { [commit]: plainPlugin(slug, "1.0.0") } });
  const { submission } = await createSubmission({ authorId, actor: { kind: "author", id: authorId }, via: "web", allowCreate: true, host: "github.com", repo: `${authorId}/${slug}`, ref: "v1.0.0", subpath: "", dryRun: false });
  while (await runOnce()) { /* build */ }
  expect(row(submission.id).status).toBe("awaiting_review");
  return submission.id;
}

beforeAll(async () => {
  await db.insert(schema.authors).values([
    { id: "rev2", githubId: 9102, githubLogin: "rev2", displayName: "Rev Two", role: "reviewer" },
    { id: "pal", githubId: 9103, githubLogin: "pal", displayName: "Pal" },
    { id: "chief", githubId: 9104, githubLogin: "chief", displayName: "Chief", role: "super_admin" },
  ]);
});
beforeEach(() => {
  signOut();
  resetFakes();
  db.delete(schema.rateLimits).run();
});

describe("approving names the bundle", () => {
  it("refuses an approval that names another bundle than the staged one", async () => {
    const id = await submitAs("pal", "swap-plugin");
    const seen = row(id).artifactSha256;
    rebuiltElsewhere(id);
    await signIn("rev2");
    const res = await approve(id, { artifactSha256: seen });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("bundle_changed");
    expect(res.body.error.message).toMatch(/built again/i);
    expect(row(id).status).toBe("awaiting_review");
  });

  it("approves when the hash is the staged bundle's", async () => {
    const id = await submitAs("pal", "same-plugin");
    await signIn("rev2");
    expect((await approve(id, { artifactSha256: row(id).artifactSha256 })).status).toBe(200);
    expect(row(id).status).toBe("publishing");
  });

  it.each([
    ["without a hash", {}],
    ["with a hash that isn't one", { artifactSha256: "abc" }],
    ["with a hash in capitals", { artifactSha256: "A".repeat(64) }],
  ])("refuses an approval %s", async (_name, body) => {
    const id = await submitAs("pal", `bare-plugin-${commitNo}`);
    await signIn("rev2");
    expect((await approve(id, body)).status).toBe(400);
    expect(row(id).status).toBe("awaiting_review");
  });

  it("holds for a super admin approving their own work", async () => {
    const id = await submitAs("chief", "chiefs-plugin");
    const seen = row(id).artifactSha256;
    rebuiltElsewhere(id);
    await signIn("chief");
    expect((await approve(id, { selfReview: true, artifactSha256: seen })).status).toBe(409);
    expect((await approve(id, { selfReview: true })).status).toBe(400);
    expect(row(id).status).toBe("awaiting_review");
    expect((await approve(id, { selfReview: true, artifactSha256: row(id).artifactSha256 })).status).toBe(200);
  });
});

describe("the review page", () => {
  /** Every element in a rendered tree, without running the components in it. */
  function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!isValidElement(node)) return [];
    const el = node as ReactElement<Record<string, unknown>>;
    return [el, ...elements(el.props.children as ReactNode)];
  }
  const approveButtons = async (id: string) => elements(await ReviewPage({ params: Promise.resolve({ id }) }))
    .filter((el) => typeof el.props.path === "string" && (el.props.path as string).endsWith("/approve"));

  it("sends back the hash of the bundle it shows", async () => {
    const id = await submitAs("pal", "page-plugin");
    await signIn("rev2");
    const buttons = await approveButtons(id);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.body).toEqual({ artifactSha256: row(id).artifactSha256 });
  });

  it("sends it with a super admin's own approval too", async () => {
    const id = await submitAs("chief", "own-page-plugin");
    await signIn("chief");
    const buttons = await approveButtons(id);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.body).toEqual({ selfReview: true, artifactSha256: row(id).artifactSha256 });
  });
});
