// Run with vitest.http.config.mts at the repo root. Needs a production build first:
//   npx next build && npx vitest run -c vitest.http.config.mts
//
// Starts the built app on a free local port against the test database and asks for every
// admin route the way a browser does: as a plain GET (HTML), in the RSC form a client-side
// navigation uses, as a link prefetch, and as a POST. Without the role the route needs,
// none of the seeded staff-only text may be anywhere in the response body. This is the
// check the page-function test can't make: what Next really sends for a page whose layout
// refuses.
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import http from "http";
import net from "net";
import path from "path";
import { sealData } from "iron-session";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_ROUTES, seedAdminData, type AdminRoute } from "../helpers/admin-seed";

const ROOT = path.join(import.meta.dirname, "..", "..");
const SECRET = "http-test-session-secret-0123456789abcdef";
let server: ChildProcess | null = null;
let port = 0;
let log = "";
const cookies: Record<string, string> = {};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

interface Answer { status: number; body: string }

/** One request with the path sent exactly as written (fetch would rewrite backslashes and dot segments). */
function ask(rawPath: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: rawPath, method: opts.method ?? "GET", headers: opts.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("error", reject);
    r.end();
  });
}

const FORMS: { form: string; make: (url: string) => { path: string; method?: string; headers: Record<string, string> } }[] = [
  { form: "HTML", make: (url) => ({ path: url, headers: {} }) },
  { form: "RSC", make: (url) => ({ path: url + (url.includes("?") ? "&" : "?") + "_rsc=t1", headers: { RSC: "1" } }) },
  { form: "Prefetch", make: (url) => ({ path: url + (url.includes("?") ? "&" : "?") + "_rsc=t2", headers: { RSC: "1", "Next-Router-Prefetch": "1" } }) },
  { form: "POST", make: (url) => ({ path: url, method: "POST", headers: { "content-length": "0" } }) },
];

async function bodyOf(route: AdminRoute, form: (typeof FORMS)[number], who: string | null, rawPath?: string): Promise<string> {
  const q = form.make(rawPath ?? route.url);
  const res = await ask(q.path, { method: q.method, headers: { ...q.headers, ...(who ? { cookie: `ext_author_session=${cookies[who]}` } : {}) } });
  return res.body;
}

beforeAll(async () => {
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) throw new Error("No production build in .next: run `npx next build` before this test.");
  await seedAdminData();
  for (const id of ["mallory", "rev", "boss"]) cookies[id] = await sealData({ authorId: id, epoch: 0 }, { password: SECRET, ttl: 3600 });
  port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "production", AUTHOR_SESSION_SECRET: SECRET, TOKEN_PEPPER: "http-test-pepper", NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (c) => (log += c));
  server.stderr?.on("data", (c) => (log += c));
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await ask("/api/v2/keys")).status > 0) break;
    } catch {
      if (server.exitCode !== null || Date.now() > deadline) throw new Error(`The built app did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}, 90_000);

afterAll(() => {
  server?.kill();
});

const STAFF = { reviewer: "rev", admin: "boss" } as const;
const CASES = ADMIN_ROUTES.flatMap((route) => FORMS.map((form) => ({ route, form, name: `${form.form} ${route.url}` })));

describe("admin routes over HTTP", () => {
  it.each(ADMIN_ROUTES)("$url carries its data for the role it is for (control)", async (route) => {
    const body = await bodyOf(route, FORMS[0], STAFF[route.needs]);
    for (const m of route.marks) expect(body).toContain(m);
  });

  it.each(CASES)("$name: nothing for a visitor without a session", async ({ route, form }) => {
    const body = await bodyOf(route, form, null);
    for (const m of route.marks) expect(body).not.toContain(m);
  });

  it.each(CASES)("$name: nothing for a signed-in author", async ({ route, form }) => {
    const body = await bodyOf(route, form, "mallory");
    for (const m of route.marks) expect(body).not.toContain(m);
  });

  it.each(CASES.filter((c) => c.route.needs === "admin"))("$name: nothing for a reviewer", async ({ route, form }) => {
    const body = await bodyOf(route, form, "rev");
    for (const m of route.marks) expect(body).not.toContain(m);
  });

  // Other spellings of the same route. Dot segments reach the page as they are; a raw
  // backslash is answered by Next with a redirect to the cleaned path. None of them may
  // carry the data.
  const reports = ADMIN_ROUTES.find((r) => r.file === "reports/page.tsx")!;
  const SPELLINGS = [
    "/x\\..\\admin\\reports?status=all", "/admin\\reports?status=all", "/x/../admin/reports?status=all", "/x/%2e%2e/admin/reports?status=all",
    "/x/%2E%2E/admin/reports?status=all", "/./admin/reports?status=all", "/admin/./reports?status=all", "/admin/reports/?status=all", "/admin//reports?status=all",
  ];
  it.each(SPELLINGS.flatMap((s) => FORMS.map((form) => ({ s, form, name: `${form.form} ${s}` }))))("$name: nothing without a staff session", async ({ s, form }) => {
    for (const who of [null, "mallory"]) {
      const body = await bodyOf(reports, form, who, s);
      for (const m of reports.marks) expect(body).not.toContain(m);
    }
  });
});
