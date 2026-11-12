// What GET and DELETE /api/v2/submissions/{id} answer a caller who may not
// see the submission: the same as for an id that doesn't exist. An API token
// is checked before the submission is looked up (401 for a bad token whatever
// the id), a valid token that may not see the submission gets 404, and a
// signed-in account's cross-site withdrawal is refused the same way for every
// id. Refused requests count against the caller's address.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { like } from "drizzle-orm";
import { addRepo, fakeSource, plainPlugin, sha } from "../helpers/fake-source";
import { req, params } from "../helpers/http";
import { signIn, signOut } from "../helpers/session";

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  source: () => fakeSource,
}));

const { db } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const { createSubmission } = await import("@/lib/publishing/submit");
const { createToken } = await import("@/lib/auth/tokens");
const { GET, DELETE } = await import("@/app/api/v2/submissions/[id]/route");

const STRANGER = "198.51.100.77";
const UNKNOWN = "0f0f0f0f-0000-4000-8000-000000000000";
const MADE_UP = `bwx_${"A".repeat(12)}_${"B".repeat(40)}xxxxxx`;
const poll = (id: string, headers: Record<string, string>) => GET(req(`/api/v2/submissions/${id}`, { headers }), params({ id }));
const withdraw = (id: string, headers: Record<string, string>) => DELETE(req(`/api/v2/submissions/${id}`, { method: "DELETE", headers }), params({ id }));

let n = 0;
async function submission(author: string) {
  n++;
  addRepo(`${author}/p${n}`, { refs: { "v1.0.0": sha(90 + n) }, commits: { [sha(90 + n)]: plainPlugin(`${author}-plugin-${n}`, "1.0.0") } });
  return createSubmission({ authorId: author, actor: { kind: "author", id: author }, via: "web", allowCreate: true, host: "github.com", repo: `${author}/p${n}`, ref: "v1.0.0", subpath: "", dryRun: false });
}

beforeAll(async () => {
  await db.insert(schema.authors).values([
    { id: "owner1", githubId: 9201, githubLogin: "owner1", displayName: "Owner" },
    { id: "stranger", githubId: 9202, githubLogin: "stranger", displayName: "Stranger" },
  ]);
});

beforeEach(() => {
  signOut();
  db.delete(schema.rateLimits).run();
});

describe("a stranger can't tell whether a submission id exists", () => {
  it("gets the same answer for an unknown id and someone else's submission without a credential", async () => {
    const { submission: s } = await submission("owner1");
    expect((await poll(UNKNOWN, { "x-forwarded-for": STRANGER })).status).toBe((await poll(s.id, { "x-forwarded-for": STRANGER })).status);
  });

  it("gets the same answer for an unknown id and someone else's submission with a made-up API token", async () => {
    const { submission: s } = await submission("owner1");
    const auth = { "x-forwarded-for": STRANGER, authorization: `Bearer ${MADE_UP}` };
    expect((await poll(s.id, auth)).status).toBe((await poll(UNKNOWN, auth)).status);
  });

  it("gets the same answer for an unknown id and someone else's submission with a valid API token of its own extension", async () => {
    const { submission: own } = await submission("stranger");
    const { token } = await createToken({ authorId: "stranger", name: "t", extensionIds: [own.extensionId!], scopes: ["publish"], days: 30 }, { kind: "author", id: "stranger" });
    const { submission: s } = await submission("owner1");
    const auth = { "x-forwarded-for": STRANGER, authorization: `Bearer ${token}` };
    expect((await poll(s.id, auth)).status).toBe((await poll(UNKNOWN, auth)).status);
  });

  it("is counted on one counter for unknown and foreign ids, and gets 429 for both after the limit", async () => {
    const { submission: s } = await submission("owner1");
    for (let i = 0; i < 60; i++) {
      await poll(UNKNOWN, { "x-forwarded-for": STRANGER });
      await poll(s.id, { "x-forwarded-for": STRANGER });
    }
    expect((await poll(UNKNOWN, { "x-forwarded-for": STRANGER })).status).toBe(429);
    expect((await poll(s.id, { "x-forwarded-for": STRANGER })).status).toBe(429);
  });

  it("answers 401 for a bad API token and 404 for a valid one that may not see the submission, on both methods", async () => {
    const { submission: own } = await submission("stranger");
    const { token } = await createToken({ authorId: "stranger", name: "t", extensionIds: [own.extensionId!], scopes: ["publish"], days: 30 }, { kind: "author", id: "stranger" });
    const { submission: s } = await submission("owner1");
    for (const id of [s.id, UNKNOWN]) {
      expect((await poll(id, { "x-forwarded-for": STRANGER, authorization: `Bearer ${MADE_UP}` })).status).toBe(401);
      expect((await withdraw(id, { "x-forwarded-for": STRANGER, authorization: `Bearer ${MADE_UP}` })).status).toBe(401);
      expect((await poll(id, { "x-forwarded-for": STRANGER, authorization: `Bearer ${token}` })).status).toBe(404);
      expect((await withdraw(id, { "x-forwarded-for": STRANGER, authorization: `Bearer ${token}` })).status).toBe(404);
    }
    // The token still reads its own extension's submission.
    expect((await poll(own.id, { "x-forwarded-for": STRANGER, authorization: `Bearer ${token}` })).status).toBe(200);
  });

  it("refuses a signed-in account's cross-site withdrawal the same way for every id", async () => {
    const { submission: s } = await submission("owner1");
    await signIn("stranger");
    const headers = { "x-forwarded-for": STRANGER, origin: "https://elsewhere.example" };
    expect((await withdraw(s.id, headers)).status).toBe((await withdraw(UNKNOWN, headers)).status);
  });
});

describe("the caller address the counter uses", () => {
  it("takes x-real-ip over x-forwarded-for", async () => {
    for (let i = 0; i < 121; i++) await poll(UNKNOWN, { "x-real-ip": "192.0.2.1", "x-forwarded-for": `192.0.2.${(i % 200) + 2}` });
    expect((await poll(UNKNOWN, { "x-real-ip": "192.0.2.1" })).status).toBe(429);
    expect((await poll(UNKNOWN, { "x-real-ip": "192.0.2.250" })).status).toBe(404);
  });

  it("documents: an address header the caller sends itself gets a fresh counter each time (fine only behind a proxy that sets it)", async () => {
    for (let i = 0; i < 130; i++) expect((await poll(UNKNOWN, { "x-real-ip": `203.0.113.${i % 250}`, "x-forwarded-for": "1.1.1.1" })).status).toBe(404);
    const rows = db.select().from(schema.rateLimits).where(like(schema.rateLimits.key, "poll-ip:%")).all();
    expect(rows.length).toBeGreaterThan(120);
  });
});
