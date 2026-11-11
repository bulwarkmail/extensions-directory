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
// HttpError) passes. The tables of pages and other route files are checked against the
// files under app/admin, and the reader table against the exports of lib/dashboard.ts, so
// a new page, route handler, layout or reader fails this test until it is added.
import fs from "fs";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signIn, signOut } from "./helpers/session";
import { ADMIN_ROUTES, MARK, SUB_ID, seedAdminData, type AdminRoute } from "./helpers/admin-seed";

// Files Next serves a request from: pages, route handlers, layouts and the other special
// files, and metadata routes. Plain components next to them (nav.tsx, files.tsx) are not.
const ROUTE_FILE = /^(page|route|layout|template|default|loading|error|global-error|not-found|forbidden|unauthorized|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(tsx|ts|jsx|js|mdx)$/;
const SOURCE_EXT = /\.(tsx|ts|jsx|js|mdx)$/;
const ADMIN_DIR = path.join(import.meta.dirname, "..", "app", "admin");

/** Every route file under app/admin, relative to it, with forward slashes. */
function routeFiles(dir = ADMIN_DIR): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? routeFiles(path.join(dir, e.name)) : ROUTE_FILE.test(e.name) ? [path.relative(ADMIN_DIR, path.join(dir, e.name)).replace(/\\/g, "/")] : []
  );
}

const isPage = (file: string) => /(^|\/)page\.\w+$/.test(file);
const FOUND = routeFiles().sort();
const FOUND_PAGES = FOUND.filter(isPage);
const FOUND_OTHERS = FOUND.filter((f) => !isPage(f));

// Route files under app/admin other than pages, with the URL they answer. Each is called
// below without a staff session; a new one fails "every other route file is listed" until
// someone has looked at it and added it here.
const OTHER_ROUTE_FILES: { file: string; url: string }[] = [
  { file: "layout.tsx", url: "/admin" },
];

const ALL_MARKS = Object.values(MARK);
const CHILD = "CHILD-PAGE-SENTINEL";

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

const load = (file: string) => import(/* @vite-ignore */ `@/app/admin/${file.replace(SOURCE_EXT, "")}`);

/** Calls the page of a route with the props Next would give it for the route's URL. */
async function open(route: AdminRoute): Promise<unknown> {
  const mod = await load(route.file);
  const query = Object.fromEntries(new URL(route.url, "https://extensions.test").searchParams);
  return mod.default({ params: Promise.resolve({ id: SUB_ID }), searchParams: Promise.resolve(query) });
}

/** The props Next hands any admin route file, with the queries that show the most. */
const ANY_PROPS = () => ({
  children: CHILD,
  params: Promise.resolve({ id: SUB_ID }),
  searchParams: Promise.resolve({ status: "all" }),
  error: new Error("test"),
  reset: () => {},
});

/**
 * Everything a route file answers for a URL: the body of every HTTP method a route
 * handler exports, or what the default export of any other file returns (the body, when
 * that is a Response).
 */
async function answer(file: string, url: string): Promise<string> {
  const mod = (await load(file)) as Record<string, unknown>;
  const parts: string[] = [];
  const text = async (run: () => unknown) => {
    try {
      const out = await run();
      return out instanceof Response ? await out.text() : await rendered(() => out);
    } catch {
      return "";
    }
  };
  if (/(^|\/)route\.\w+$/.test(file)) {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const handler = mod[method];
      if (typeof handler !== "function") continue;
      parts.push(await text(() => handler(new Request(new URL(url, "https://extensions.test"), { method }), { params: Promise.resolve({ id: SUB_ID }) })));
    }
  } else if (typeof mod.default === "function") {
    const render = mod.default as (props: unknown) => unknown;
    parts.push(await text(() => render(ANY_PROPS())));
  }
  return parts.join(" | ");
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
    expect(FOUND_PAGES).toEqual(ADMIN_ROUTES.map((r) => r.file).sort());
  });

  it("every other route file under app/admin is listed", () => {
    expect(FOUND_OTHERS).toEqual(OTHER_ROUTE_FILES.map((r) => r.file).sort());
  });

  it.each(FOUND_PAGES)("%s gives a visitor and a signed-in author none of the seeded staff data", async (file) => {
    const route = ADMIN_ROUTES.find((r) => r.file === file);
    for (const who of [null, "mallory"]) {
      signOut();
      if (who) await signIn(who);
      const out = await answer(file, route?.url ?? "/admin");
      for (const m of ALL_MARKS) expect(out).not.toContain(m);
    }
  });

  it.each(FOUND_OTHERS)("%s answers a visitor and a signed-in author with none of the seeded staff data", async (file) => {
    const url = OTHER_ROUTE_FILES.find((r) => r.file === file)?.url ?? "/admin";
    for (const who of [null, "mallory"]) {
      signOut();
      if (who) await signIn(who);
      const out = await answer(file, url);
      for (const m of ALL_MARKS) expect(out).not.toContain(m);
    }
  });

  it("the admin layout passes its page through for staff only (control)", async () => {
    expect(await answer("layout.tsx", "/admin")).not.toContain(CHILD);
    await signIn("mallory");
    expect(await answer("layout.tsx", "/admin")).not.toContain(CHILD);
    await signIn("rev");
    expect(await answer("layout.tsx", "/admin")).toContain(CHILD);
  });

  // Next resolves a route's metadata apart from its component, so a generateMetadata
  // export runs for every visitor whatever the page checks.
  it.each(FOUND)("%s: its metadata gives a visitor and a signed-in author none of the seeded staff data", async (file) => {
    const mod = (await load(file)) as { metadata?: unknown; generateMetadata?: (props: unknown, parent: unknown) => unknown };
    for (const who of [null, "mallory"]) {
      signOut();
      if (who) await signIn(who);
      const out = [await rendered(() => mod.metadata), await rendered(() => mod.generateMetadata?.(ANY_PROPS(), Promise.resolve({})))].join(" | ");
      for (const m of ALL_MARKS) expect(out).not.toContain(m);
    }
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
//
// The module's other exports read for the signed-in author: they take the caller's id or
// session user, and the dashboard pages pass their own. Every export not listed here is
// treated as a staff reader.
const AUTHOR_READERS = ["myExtensions", "mySubmissions", "manageData", "submissionFor", "myTokens", "downloadsLast30", "myWebhooks"];
const dashboard = (await import("@/lib/dashboard")) as unknown as Record<string, unknown>;
const STAFF_EXPORTS = Object.keys(dashboard).filter((name) => typeof dashboard[name] === "function" && !AUTHOR_READERS.includes(name)).sort();

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
    expect(typeof dashboard[name]).toBe("function");
    return rendered(() => (dashboard[name] as (...a: unknown[]) => unknown)(...args));
  };

  it("every staff reader lib/dashboard.ts exports is in the reader table", () => {
    expect(STAFF_EXPORTS).toEqual([...READERS.map((r) => r.name), "adminCounts"].sort());
  });

  it.each(STAFF_EXPORTS)("%s refuses a visitor, a signed-in author and a banned admin before it reads anything", async (name) => {
    for (const who of [null, "mallory", "banned-boss"]) {
      signOut();
      if (who) await signIn(who);
      // No arguments: the role check comes first, so the refusal can't depend on them.
      await expect((async () => (dashboard[name] as () => unknown)())()).rejects.toMatchObject({ status: 403 });
    }
  });

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
