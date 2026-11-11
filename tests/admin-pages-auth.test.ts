// Run: npx vitest run tests/admin-pages-auth.test.ts
//
// Every page under /admin reads the database in its own server component. Next renders a
// page whatever its layout returns and sends the result to the browser, so the role check
// in app/admin/layout.tsx can't stand in for the pages'. Each page, and each staff data
// reader, refuses on its own (lib/auth/staff.ts).
//
// The test calls each page component the way Next does and looks at everything it
// returned (the element tree with its props). Without the role the route needs, none of
// the seeded staff-only text may be in it. A page that throws (redirect, notFound, an
// HttpError) passes. The route table is checked against the files under app/admin, so a
// new page fails this test until it is added to the table.
import fs from "fs";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signIn, signOut } from "./helpers/session";
import { ADMIN_ROUTES, MARK, SUB_ID, seedAdminData, type AdminRoute } from "./helpers/admin-seed";

/** Everything a page handed back: text, props of child components, attributes. */
function collect(value: unknown, seen: WeakSet<object>, out: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number") { out.push(String(value)); return; }
  if (value instanceof Date) return;
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { for (const v of value) collect(v, seen, out); return; }
  for (const [key, v] of Object.entries(value)) {
    // A React element: its props are what the page passes on; the component itself is not data.
    if (key === "type" || key.startsWith("_") || key === "$$typeof") continue;
    out.push(key);
    collect(v, seen, out);
  }
}

async function rendered(run: () => unknown): Promise<string> {
  try {
    const out: string[] = [];
    collect(await run(), new WeakSet(), out);
    return out.join(" | ");
  } catch {
    return "";
  }
}

/** Calls the page of a route with the props Next would give it for the route's URL. */
async function open(route: AdminRoute): Promise<unknown> {
  const mod = await import(/* @vite-ignore */ `@/app/admin/${route.file.replace(/\.tsx$/, "")}`);
  const query = Object.fromEntries(new URL(route.url, "https://extensions.test").searchParams);
  return mod.default({ params: Promise.resolve({ id: SUB_ID }), searchParams: Promise.resolve(query) });
}

function pageFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pageFiles(path.join(dir, e.name), base) : e.name === "page.tsx" ? [path.relative(base, path.join(dir, e.name)).replace(/\\/g, "/")] : []
  );
}

const STAFF = { reviewer: "rev", admin: "boss" } as const;
const ADMIN_ONLY = ADMIN_ROUTES.filter((r) => r.needs === "admin");

beforeAll(seedAdminData);
beforeAll(async () => {
  // An admin who is banned, and an admin whose sessions were all ended after the test's cookie was made.
  const { db } = await import("@/lib/db/client");
  const schema = await import("@/lib/db/schema");
  await db.insert(schema.authors).values([
    { id: "banned-boss", githubId: 5101, githubLogin: "banned-boss", displayName: "Banned", role: "admin", banned: true, bannedAt: new Date() },
    { id: "old-boss", githubId: 5102, githubLogin: "old-boss", displayName: "Old", role: "admin", sessionEpoch: 2 },
  ]);
});
beforeEach(() => signOut());

describe("admin pages check the role themselves", () => {
  it("the route table lists every page under app/admin", () => {
    const found = pageFiles(path.join(import.meta.dirname, "..", "app", "admin")).sort();
    expect(found).toEqual(ADMIN_ROUTES.map((r) => r.file).sort());
  });

  it.each(ADMIN_ROUTES)("$url shows its data to the role it is for (control)", async (route) => {
    await signIn(STAFF[route.needs]);
    const out = await rendered(() => open(route));
    for (const m of route.marks) expect(out).toContain(m);
  });

  it.each(ADMIN_ROUTES)("$url gives a visitor without a session nothing", async (route) => {
    const out = await rendered(() => open(route));
    for (const m of route.marks) expect(out).not.toContain(m);
  });

  it.each(ADMIN_ROUTES)("$url gives a signed-in author nothing", async (route) => {
    await signIn("mallory");
    const out = await rendered(() => open(route));
    for (const m of route.marks) expect(out).not.toContain(m);
  });

  it.each(ADMIN_ONLY)("$url gives a reviewer nothing", async (route) => {
    await signIn("rev");
    const out = await rendered(() => open(route));
    for (const m of route.marks) expect(out).not.toContain(m);
  });

  it("a submission id that does not exist looks the same as one that does, without a session", async () => {
    const page = (await import("@/app/admin/submissions/[id]/page")).default;
    const known = await rendered(() => page({ params: Promise.resolve({ id: SUB_ID }) }));
    const unknown = await rendered(() => page({ params: Promise.resolve({ id: "ffffffff-0000-4000-8000-000000000000" }) }));
    expect(known).toBe(unknown);
  });

  it("a submission id that does not exist looks the same as one that does, for a signed-in author", async () => {
    await signIn("mallory");
    const page = (await import("@/app/admin/submissions/[id]/page")).default;
    const known = await rendered(() => page({ params: Promise.resolve({ id: SUB_ID }) }));
    const unknown = await rendered(() => page({ params: Promise.resolve({ id: "ffffffff-0000-4000-8000-000000000000" }) }));
    expect(known).toBe(unknown);
  });
});

// Sessions that currentUser() treats as signed out: a banned account, and a cookie from
// before the account's last sign-out everywhere (an older session epoch).
async function signInOutdated(): Promise<void> {
  const { getSession } = await import("@/lib/auth/session");
  const session = await getSession();
  session.authorId = "old-boss";
  session.epoch = 1;
  await session.save();
}

describe("admin pages for sessions that count as signed out", () => {
  it.each(ADMIN_ROUTES)("$url gives a banned admin nothing", async (route) => {
    await signIn("banned-boss");
    const out = await rendered(() => open(route));
    for (const m of route.marks) expect(out).not.toContain(m);
  });

  it.each(ADMIN_ROUTES)("$url gives an admin's outdated session nothing", async (route) => {
    await signInOutdated();
    const out = await rendered(() => open(route));
    for (const m of route.marks) expect(out).not.toContain(m);
  });
});

// The filtered pages read ?status= before they render; whatever it holds, the role check
// comes first.
describe("admin pages with any ?status=", () => {
  const FILTERED = ADMIN_ROUTES.filter((r) => r.file === "submissions/page.tsx" || r.file === "reports/page.tsx");
  const STATUSES: (string | string[] | undefined)[] = [undefined, "", "open", "awaiting_review", "all", "no-such-status", ["all", "open"]];
  const CASES = FILTERED.flatMap((route) => STATUSES.map((status) => ({ route, status, name: `${route.file} ?status=${JSON.stringify(status)}` })));

  it.each(CASES)("$name gives a visitor and a signed-in author nothing", async ({ route, status }) => {
    const mod = await import(/* @vite-ignore */ `@/app/admin/${route.file.replace(/\.tsx$/, "")}`);
    for (const who of [null, "mallory"]) {
      signOut();
      if (who) await signIn(who);
      const out = await rendered(() => mod.default({ searchParams: Promise.resolve(status === undefined ? {} : { status }) }));
      for (const m of route.marks) expect(out).not.toContain(m);
    }
  });
});

// The staff readers in lib/dashboard.ts are what the pages call. They check the session
// themselves, so a page that forgets its own check still gets nothing.
const READERS: { name: string; args: unknown[]; needs: "reviewer" | "admin"; marks: string[] }[] = [
  { name: "reviewQueue", args: ["all"], needs: "reviewer", marks: [MARK.queued] },
  { name: "allReports", args: ["all"], needs: "reviewer", marks: [MARK.reporter] },
  { name: "allAdvisories", args: [], needs: "reviewer", marks: [MARK.draft] },
  { name: "pendingTextChanges", args: [], needs: "reviewer", marks: [MARK.pendingText] },
  { name: "allRatings", args: [], needs: "reviewer", marks: [MARK.rating] },
  { name: "allExtensions", args: [], needs: "reviewer", marks: [MARK.queued] },
  { name: "allAuthors", args: [undefined], needs: "admin", marks: [MARK.account] },
  { name: "allTokens", args: [], needs: "admin", marks: [MARK.token] },
  { name: "auditEntries", args: [{ page: 1 }], needs: "admin", marks: [MARK.audit] },
  { name: "submissionForReview", args: [SUB_ID], needs: "reviewer", marks: [MARK.manifest, MARK.buildLog] },
];

describe("staff data readers check the role themselves", () => {
  const call = async (name: string, args: unknown[]) => {
    const dashboard = (await import("@/lib/dashboard")) as unknown as Record<string, (...a: unknown[]) => unknown>;
    expect(typeof dashboard[name]).toBe("function");
    return rendered(() => dashboard[name](...args));
  };

  it.each(READERS)("$name answers the role it is for (control)", async ({ name, args, needs, marks }) => {
    await signIn(STAFF[needs]);
    const out = await call(name, args);
    for (const m of marks) expect(out).toContain(m);
  });

  it.each(READERS)("$name gives nothing without a session", async ({ name, args, marks }) => {
    const out = await call(name, args);
    for (const m of marks) expect(out).not.toContain(m);
  });

  it.each(READERS)("$name gives a signed-in author nothing", async ({ name, args, marks }) => {
    await signIn("mallory");
    const out = await call(name, args);
    for (const m of marks) expect(out).not.toContain(m);
  });

  it.each(READERS.filter((r) => r.needs === "admin"))("$name gives a reviewer nothing", async ({ name, args, marks }) => {
    await signIn("rev");
    const out = await call(name, args);
    for (const m of marks) expect(out).not.toContain(m);
  });

  it.each(READERS)("$name gives a banned admin and an outdated admin session nothing", async ({ name, args, marks }) => {
    await signIn("banned-boss");
    const banned = await call(name, args);
    signOut();
    await signInOutdated();
    const outdated = await call(name, args);
    for (const m of marks) {
      expect(banned).not.toContain(m);
      expect(outdated).not.toContain(m);
    }
  });

  it("adminCounts gives no counts without a staff session", async () => {
    expect(await call("adminCounts", [])).toBe("");
    await signIn("mallory");
    expect(await call("adminCounts", [])).toBe("");
    await signIn("rev");
    expect(await call("adminCounts", [])).not.toBe("");
  });
});
