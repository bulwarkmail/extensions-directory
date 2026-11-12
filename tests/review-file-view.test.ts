// The reviewer approves "this exact bundle" after reading its files through
// GET /api/v2/admin/submissions/:id/file. Every character of a text file has to be
// reachable through that route, for the new version and for the previous one.
//
// The route answers in parts: `text` and `previous` start at `?offset=` (0 when left out)
// and `nextOffset` is the offset of the next part, or null when both texts are complete.
// The test reads a file by following `nextOffset`, as the review page does.
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { req } from "./helpers/http";
import { signIn, signOut } from "./helpers/session";
import { addRepo, fakeSource, resetFakes, sha } from "./helpers/fake-source";
import { PNG_1PX } from "./fixtures/seed";

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  source: () => fakeSource,
}));

const { db } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const { router } = await import("@/lib/api/router");
const { v2Routes } = await import("@/lib/api/v2");
const { createSubmission } = await import("@/lib/publishing/submit");
const { approveSubmission } = await import("@/lib/review");
const { runOnce } = await import("@/lib/worker");
const { resetSignerCache } = await import("@/lib/signing");

const dispatch = router(v2Routes);
interface Part { text: string | null; previous: string | null; size: number; nextOffset?: number | null }
const part = async (id: string, name: string, offset: number) => {
  const res = await dispatch("GET")(req(`/api/v2/admin/submissions/${id}/file?path=${encodeURIComponent(name)}${offset ? `&offset=${offset}` : ""}`));
  return (await res.json()).data as Part;
};
/** The file as the reviewer can read it: every part, joined. */
const file = async (id: string, name: string) => {
  let offset = 0;
  let text: string | null = null;
  let previous: string | null = null;
  let size = 0;
  for (let i = 0; i < 100; i++) {
    const p = await part(id, name, offset);
    size = p.size;
    if (p.text !== null) text = (text ?? "") + p.text;
    if (p.previous !== null) previous = (previous ?? "") + p.previous;
    if (p.nextOffset === null || p.nextOffset === undefined) break;
    expect(p.nextOffset).toBeGreaterThan(offset);
    offset = p.nextOffset;
  }
  return { text, previous, size };
};

// 1.15 MB of short lines (so nothing looks minified), then the part that matters.
const FILLER = Array.from({ length: 76_000 }, (_, i) => `  "w${i.toString(36).padStart(8, "0")}",`).join("\n");
const entry = (tail: string) => `const WORDS = [\n${FILLER}\n];\n${tail}\n`;
const TAIL_1 = "module.exports = { activate() { /* TAIL-ONE */ } };";
const TAIL_2 = "module.exports = { activate(api) { api.hooks.onEmailOpen((m) => globalThis.TAIL_TWO(m)); } };";

const files = (version: string, tail: string) => ({
  "manifest.json": JSON.stringify({ id: "big-tail", name: "Big Tail", version, author: "Test", description: "Word counts", type: "ui-extension", entrypoint: "index.js", permissions: ["email:read"] }),
  "index.js": entry(tail),
  "helper.js": "/* \u0000 */\n// NUL-FILE-MARKER\nmodule.exports = {};\n",
});

async function drain() {
  while (await runOnce()) { /* every queued job */ }
}
async function submit(ref: string) {
  const { submission } = await createSubmission({ authorId: "dana", actor: { kind: "author", id: "dana" }, via: "web", allowCreate: true, host: "github.com", repo: "dana/big-tail", ref, subpath: "", dryRun: false });
  await drain();
  const row = db.select().from(schema.submissions).where(eq(schema.submissions.id, submission.id)).get()!;
  expect(row.status).toBe("awaiting_review");
  return row;
}

let firstRow: Awaited<ReturnType<typeof submit>> | null = null;
/** Version 1.0.0, built once and waiting for review. */
async function first() {
  firstRow ??= await submit("v1.0.0");
  return firstRow;
}

beforeAll(async () => {
  await db.insert(schema.authors).values([
    { id: "dana", githubId: 7001, githubLogin: "dana", displayName: "Dana" },
    { id: "rev", githubId: 7002, githubLogin: "rev", displayName: "Rev", role: "reviewer" },
  ]);
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "extdir-key-")), "signing.pem");
  fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  process.env.SIGNING_KEY_FILE = keyFile;
  resetSignerCache();
});

beforeEach(() => {
  signOut();
  resetFakes();
  db.delete(schema.rateLimits).run();
  addRepo("dana/big-tail", { refs: { "v1.0.0": sha(51), "v1.0.1": sha(52) }, commits: { [sha(51)]: files("1.0.0", TAIL_1), [sha(52)]: files("1.0.1", TAIL_2) } });
});

describe("the reviewer's file view", () => {
  it("gives the whole of a large file", async () => {
    const s = await first();
    await signIn("rev");
    const f = await file(s.id, "index.js");
    expect(f.size).toBeGreaterThan(1_000_000);
    expect(f.text).toBe(entry(TAIL_1));
  });

  it("answers an offset past the end with an empty last part", async () => {
    const s = await first();
    await signIn("rev");
    const p = await part(s.id, "index.js", 50_000_000);
    expect(p.text).toBe("");
    expect(p.nextOffset ?? null).toBe(null);
  });

  it("shows a .js file with a NUL byte as text", async () => {
    const s = await first();
    await signIn("rev");
    const f = await file(s.id, "helper.js");
    expect(f.text).toContain("NUL-FILE-MARKER");
  });

  it("warns in the scan about a text file with a NUL byte and a file longer than one part", async () => {
    const s = await first();
    const findings = (s.scanReport as { findings: { rule: string; file?: string; severity: string }[] }).findings;
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "text-nul-byte", file: "helper.js", severity: "warn" }),
      expect.objectContaining({ rule: "file-over-review-part", file: "index.js", severity: "warn" }),
    ]));
    expect(findings.filter((f) => f.rule === "text-nul-byte" || f.rule === "file-over-review-part")).toHaveLength(2);
  });

  it("gives both versions whole when an update changed only the end of a large file", async () => {
    await approveSubmission((await first()).id, "rev", null);
    await drain();
    const second = await submit("v1.0.1");
    expect((second.diffSummary as { changed: string[] }).changed).toContain("index.js");
    await signIn("rev");
    const f = await file(second.id, "index.js");
    expect(f.text).toBe(entry(TAIL_2));
    expect(f.previous).toBe(entry(TAIL_1));
  });
});

describe("the parts of a file", () => {
  // The first part would end between the two halves of the emoji.
  const WIDE = `/*${"a".repeat(999_997)}\u{1F600} tail */\nmodule.exports = {};\n`;
  let edgeRow: Awaited<ReturnType<typeof submit>> | null = null;
  async function edge() {
    if (edgeRow) return edgeRow;
    addRepo("dana/edge-files", { refs: { "v1.0.0": sha(61) }, commits: { [sha(61)]: {
      "manifest.json": JSON.stringify({ id: "edge-files", name: "Edge files", version: "1.0.0", author: "Test", description: "Edges", type: "ui-extension", entrypoint: "index.js", permissions: ["ui:toolbar"] }),
      "index.js": "module.exports = { activate() {} };\n",
      "wide.js": WIDE,
      "logo.png": PNG_1PX,
    } } });
    const { submission } = await createSubmission({ authorId: "dana", actor: { kind: "author", id: "dana" }, via: "web", allowCreate: true, host: "github.com", repo: "dana/edge-files", ref: "v1.0.0", subpath: "", dryRun: false });
    await drain();
    edgeRow = db.select().from(schema.submissions).where(eq(schema.submissions.id, submission.id)).get()!;
    expect(edgeRow.status).toBe("awaiting_review");
    return edgeRow;
  }

  it("cuts a part on a character boundary, never inside a surrogate pair", async () => {
    const s = await edge();
    await signIn("rev");
    const p = await part(s.id, "wide.js", 0) as Part & { textLength: number };
    expect(p.textLength).toBe(WIDE.length);
    expect(p.text!.length).toBe(999_999);
    expect(p.nextOffset).toBe(999_999);
    const code = p.text!.charCodeAt(p.text!.length - 1);
    expect(code >= 0xd800 && code <= 0xdbff).toBe(false);
    expect((await part(s.id, "wide.js", 999_999)).text!.startsWith("\u{1F600}")).toBe(true);
    expect((await file(s.id, "wide.js")).text).toBe(WIDE);
  });

  it("gives the total lengths and no next part for a small file", async () => {
    const s = await edge();
    await signIn("rev");
    const p = await part(s.id, "index.js", 0) as Part & { textLength: number; previousLength: number | null };
    expect(p).toMatchObject({ text: "module.exports = { activate() {} };\n", textLength: 36, previous: null, previousLength: null, nextOffset: null });
  });

  it("still answers no text for a real binary file", async () => {
    const s = await edge();
    await signIn("rev");
    const p = await part(s.id, "logo.png", 0);
    expect(p.text).toBe(null);
    expect(p.size).toBe(PNG_1PX.length);
  });

  it.each(["-1", "abc", "1.5", "1e3", "", " 2"])("refuses the offset %j", async (offset) => {
    const s = await edge();
    await signIn("rev");
    const res = await dispatch("GET")(req(`/api/v2/admin/submissions/${s.id}/file?path=wide.js&offset=${encodeURIComponent(offset)}`));
    expect(res.status).toBe(400);
  });
});
