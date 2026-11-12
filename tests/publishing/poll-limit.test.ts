// Polling a submission. GET /api/v2/submissions/{id} with a valid credential
// (the poll token, an API token for the extension, or a maintainer's or
// reviewer's session) counts against the submission, 120 an hour. A request
// without one counts against the caller's address instead, so it can't use
// up the polls of a job that waits for its build, and it leaves no counter
// named after the id it sent. Withdrawals (DELETE) without a credential count
// the same way.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { like } from "drizzle-orm";
import { addRepo, fakeSource, plainPlugin, sha } from "../helpers/fake-source";
import { req, params, BASE } from "../helpers/http";
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

const STRANGER = "198.51.100.23";
const OWNER = "203.0.113.50";

const poll = (id: string, from: string, token?: string) =>
  GET(req(`/api/v2/submissions/${id}`, { headers: { "x-forwarded-for": from, ...(token ? { authorization: `Bearer ${token}` } : {}) } }), params({ id }));

let n = 0;
async function submission() {
  n++;
  addRepo(`alice2/p${n}`, { refs: { "v1.0.0": sha(70 + n) }, commits: { [sha(70 + n)]: plainPlugin(`alice-plugin-${n}`, "1.0.0") } });
  return createSubmission({ authorId: "alice2", actor: { kind: "author", id: "alice2" }, via: "web", allowCreate: true, host: "github.com", repo: `alice2/p${n}`, ref: "v1.0.0", subpath: "", dryRun: false });
}

beforeAll(async () => {
  await db.insert(schema.authors).values({ id: "alice2", githubId: 9101, githubLogin: "alice2", displayName: "Alice" });
});

beforeEach(() => {
  signOut();
  db.delete(schema.rateLimits).run();
});

describe("polling a submission", () => {
  it("still answers its owner after a stranger asked 121 times", async () => {
    const { submission: s, pollToken } = await submission();
    for (let i = 0; i < 121; i++) await poll(s.id, STRANGER);
    expect((await poll(s.id, OWNER, pollToken)).status).toBe(200);
  });

  it("still answers its owner after a stranger sent 121 wrong poll tokens", async () => {
    const { submission: s, pollToken } = await submission();
    for (let i = 0; i < 121; i++) await poll(s.id, STRANGER, `bwp_${"0".repeat(40)}`);
    expect((await poll(s.id, OWNER, pollToken)).status).toBe(200);
  });

  it("writes no counter named after an id that is no submission", async () => {
    for (let i = 0; i < 5; i++) await poll(`no-such-submission-${i}`, STRANGER);
    const rows = db.select().from(schema.rateLimits).where(like(schema.rateLimits.key, "%no-such-submission-%")).all();
    expect(rows).toEqual([]);
  });

  it("limits a caller without a credential by address, and only that caller", async () => {
    const { submission: s, pollToken } = await submission();
    const statuses: number[] = [];
    for (let i = 0; i < 600; i++) statuses.push((await poll(i % 2 ? s.id : `no-such-submission-${i}`, STRANGER)).status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses[0]).toBe(404);
    // Another address, with the poll token, is not affected.
    expect((await poll(s.id, OWNER, pollToken)).status).toBe(200);
  });

  it("keeps the limit per submission for polls with a valid credential (control)", async () => {
    const { submission: s, pollToken } = await submission();
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) statuses.push((await poll(s.id, OWNER, pollToken)).status);
    expect(statuses[0]).toBe(200);
    expect(statuses.at(-1)).toBe(429);
  });

  it("counts callers without an address under one shared counter", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) {
      const id = `no-such-submission-${i}`;
      statuses.push((await GET(req(`/api/v2/submissions/${id}`, { headers: { "x-forwarded-for": "" } }), params({ id }))).status);
    }
    expect(statuses[0]).toBe(404);
    expect(statuses.at(-1)).toBe(429);
  });

  it("counts an API token for another extension against the caller's address, not the submission", async () => {
    const { submission: s, pollToken } = await submission();
    const { submission: other } = await submission();
    const { token } = await createToken({ authorId: "alice2", name: "ci", extensionIds: [other.extensionId!], scopes: ["read"], days: 1 }, { kind: "author", id: "alice2" });
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) statuses.push((await poll(s.id, STRANGER, token)).status);
    expect(statuses[0]).toBe(404);
    expect(statuses.at(-1)).toBe(429);
    expect((await poll(s.id, OWNER, pollToken)).status).toBe(200);
    // For its own extension the token still reads.
    expect((await poll(other.id, OWNER, token)).status).toBe(200);
  });
});

describe("withdrawing a submission", () => {
  const withdraw = (id: string, from: string, headers: Record<string, string> = {}) =>
    DELETE(req(`/api/v2/submissions/${id}`, { method: "DELETE", headers: { "x-forwarded-for": from, ...headers } }), params({ id }));

  it("counts requests without a credential against the caller's address, and its owner still withdraws it", async () => {
    const { submission: s } = await submission();
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) statuses.push((await withdraw(s.id, STRANGER)).status);
    expect(statuses[0]).toBe(404);
    expect(statuses.at(-1)).toBe(429);

    await signIn("alice2");
    expect((await withdraw(s.id, OWNER, { origin: new URL(BASE).origin })).status).toBe(200);
  });
});
