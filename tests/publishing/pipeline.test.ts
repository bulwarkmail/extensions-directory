// Submission → build → review → publish, with a fake source host and runner.
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { seed } from "../fixtures/seed";
import { addRepo, fakeSource, plainPlugin, resetFakes, sha } from "../helpers/fake-source";

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  source: () => fakeSource,
}));

const { db } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const { authors, extensions, extensionVersions, submissions } = schema;
const { createSubmission } = await import("@/lib/publishing/submit");
const { approveSubmission, rejectSubmission } = await import("@/lib/review");
const { runOnce } = await import("@/lib/worker");
const { setRunner } = await import("@/lib/pipeline/sandbox");
const { resetSignerCache, verify } = await import("@/lib/signing");
const { readStaged } = await import("@/lib/pipeline/staging");

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><script>alert(1)</script><rect width="32" height="32"/></svg>';
let signerPublic = "";

beforeAll(async () => {
  await seed();
  await db.insert(authors).values({ id: "staff", githubId: 3001, githubLogin: "staff", displayName: "Staff", role: "admin" });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "extdir-key-")), "signing.pem");
  fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  process.env.SIGNING_KEY_FILE = keyFile;
  resetSignerCache();
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  signerPublic = spki.subarray(spki.length - 32).toString("base64");
});

beforeEach(() => {
  resetFakes();
  setRunner(null);
  db.delete(schema.rateLimits).run();
});

const web = (authorId: string, ref: string, extra: Partial<Parameters<typeof createSubmission>[0]> = {}) =>
  createSubmission({ authorId, actor: { kind: "author", id: authorId }, via: "web", allowCreate: true, host: "github.com", repo: "alice/plugins", ref, subpath: "jitsi-meet", dryRun: false, ...extra });

async function drain() {
  while (await runOnce()) { /* run every queued job */ }
}

const sub = (id: string) => db.select().from(submissions).where(eq(submissions.id, id)).get()!;

describe("a version from submission to publication", () => {
  it("builds the pinned commit, waits for review, and publishes a signed bundle", async () => {
    addRepo("alice/plugins", {
      refs: { "v2.0.0": sha(1), main: sha(2) },
      commits: {
        [sha(1)]: Object.fromEntries(Object.entries(plainPlugin("jitsi-meet", "2.0.0", { icon: "icon.svg" }, "export default { tagged: true };\n")).map(([k, v]) => [`jitsi-meet/${k}`, v]).concat([["jitsi-meet/icon.svg", ICON]])),
        [sha(2)]: Object.fromEntries(Object.entries(plainPlugin("jitsi-meet", "2.0.0", {}, "export default { MAIN_BRANCH: true };\n")).map(([k, v]) => [`jitsi-meet/${k}`, v])),
      },
      releases: { "v2.0.0": "Big release" },
    });
    const { submission } = await web("author-alice", "v2.0.0");
    expect(submission).toMatchObject({ status: "queued", sourceCommit: sha(1), version: "2.0.0", slug: "jitsi-meet" });

    await drain();
    const built = sub(submission.id);
    expect(built.status).toBe("awaiting_review");
    expect(built.releaseNotes).toBe("Big release");
    const zip = await JSZip.loadAsync(await readStaged(built.artifactPath!));
    expect(Object.keys(zip.files).sort()).toEqual(["index.js", "manifest.json"]);
    expect(await zip.file("index.js")!.async("string")).toContain("tagged");
    expect(built.media?.icon).toMatch(/^[0-9a-f-]+\/icon-[0-9a-f]{12}\.png$/);

    await approveSubmission(submission.id, "staff", "Looks good");
    expect(sub(submission.id).status).toBe("publishing");
    await drain();

    const done = sub(submission.id);
    expect(done.status).toBe("approved");
    const v = db.select().from(extensionVersions).where(eq(extensionVersions.id, done.versionId!)).get()!;
    expect(v).toMatchObject({ version: "2.0.0", sourceCommit: sha(1), sourceRef: "v2.0.0", submittedVia: "web", reviewedBy: "staff", changelog: "Big release", channel: "stable" });
    expect(v.bundleSha256).toBe(built.artifactSha256);
    expect(verify(signerPublic, v.signedStatement!, v.signature!)).toBe(true);
    expect(JSON.parse(v.signedStatement!)).toMatchObject({ slug: "jitsi-meet", version: "2.0.0", bundle: { sha256: built.artifactSha256 }, source: { commit: sha(1) } });
    const stored = fs.readFileSync(path.join(process.env.UPLOADS_DIR!, v.bundlePath));
    expect(crypto.createHash("sha256").update(stored).digest("hex")).toBe(v.bundleSha256);
    const ext = db.select().from(extensions).where(eq(extensions.id, "ext-jitsi")).get()!;
    expect(ext.latestStableVersionId).toBe(v.id);
    expect(ext.iconPath).toMatch(/^media\/jitsi-meet\/icon-[0-9a-f]{12}\.png$/);
  });
});

describe("who may submit", () => {
  it("refuses another author's extension", async () => {
    addRepo("alice/plugins", { refs: { x: sha(3) }, commits: { [sha(3)]: { "jitsi-meet/manifest.json": plainPlugin("jitsi-meet", "9.0.0")["manifest.json"] } } });
    await expect(web("author-bob", "x")).rejects.toMatchObject({ message: expect.stringContaining("not a maintainer") });
  });

  it("refuses a banned author", async () => {
    addRepo("alice/plugins", { refs: { x: sha(3) }, commits: { [sha(3)]: { "jitsi-meet/manifest.json": plainPlugin("jitsi-meet", "9.0.0")["manifest.json"] } } });
    await db.update(authors).set({ bannedAt: new Date(), banned: true }).where(eq(authors.id, "author-alice"));
    try {
      await expect(web("author-alice", "x")).rejects.toMatchObject({ status: 403 });
    } finally {
      await db.update(authors).set({ bannedAt: null, banned: false }).where(eq(authors.id, "author-alice"));
    }
  });

  it("refuses a version that is already published", async () => {
    addRepo("alice/plugins", { refs: { x: sha(4) }, commits: { [sha(4)]: { "jitsi-meet/manifest.json": plainPlugin("jitsi-meet", "1.0.0")["manifest.json"] } } });
    await expect(web("author-alice", "x")).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a private repository", async () => {
    addRepo("alice/plugins", { info: { isPublic: false } as never, refs: { x: sha(4) }, commits: { [sha(4)]: {} } });
    await expect(web("author-alice", "x")).rejects.toMatchObject({ status: 400, code: "repo_private" });
  });

  it("stops building when the author is banned after submitting", async () => {
    addRepo("alice/plugins", { refs: { x: sha(5) }, commits: { [sha(5)]: Object.fromEntries(Object.entries(plainPlugin("jitsi-meet", "3.0.0")).map(([k, v]) => [`jitsi-meet/${k}`, v])) } });
    const { submission } = await web("author-alice", "x");
    await db.update(authors).set({ bannedAt: new Date() }).where(eq(authors.id, "author-alice"));
    await drain();
    await db.update(authors).set({ bannedAt: null }).where(eq(authors.id, "author-alice"));
    expect(sub(submission.id)).toMatchObject({ status: "blocked", error: expect.stringContaining("can't publish") });
  });
});

describe("what gets built", () => {
  const files = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`jitsi-meet/${k}`, v]));

  it("never takes a bundle the author built", async () => {
    const p = plainPlugin("jitsi-meet", "4.0.0");
    addRepo("alice/plugins", { refs: { x: sha(6) }, commits: { [sha(6)]: files({ "manifest.json": p["manifest.json"], "dist/index.js": "prebuilt", "jitsi-meet.zip": "zip" }) } });
    const { submission } = await web("author-alice", "x");
    await drain();
    expect(sub(submission.id)).toMatchObject({ status: "build_failed", error: expect.stringContaining("built outside the directory") });
  });

  it("builds from source when there is a build script, ignoring committed output", async () => {
    const p = plainPlugin("jitsi-meet", "4.1.0");
    addRepo("alice/plugins", {
      refs: { x: sha(7) },
      commits: { [sha(7)]: files({ "manifest.json": p["manifest.json"], "src/index.js": "source", "dist/index.js": "STALE PREBUILT", "package.json": JSON.stringify({ scripts: { build: "esbuild" } }) }) },
    });
    const seen: string[][] = [];
    setRunner({
      name: "fake",
      async build(source) {
        seen.push([...source.keys()].sort());
        const tree = new Map(source);
        tree.set("dist/index.js", new TextEncoder().encode("export default { built: true };\n"));
        return { tree, log: "built ok", image: "node@sha256:abc" };
      },
    });
    const { submission } = await web("author-alice", "x");
    await drain();
    const s = sub(submission.id);
    expect(s.status).toBe("awaiting_review");
    expect(s).toMatchObject({ buildSource: "sandbox-build", builderImage: "node@sha256:abc", buildLog: "built ok" });
    expect(seen[0]).toContain("src/index.js");
    const zip = await JSZip.loadAsync(await readStaged(s.artifactPath!));
    expect(await zip.file("index.js")!.async("string")).toContain("built: true");
  });

  it.each([
    ["a manifest the webmail refuses", { "manifest.json": JSON.stringify({ id: "jitsi-meet", name: "J", version: "5.0.0", author: "a", description: "d", type: "plugin", pluginType: "hook", entrypoint: "index.js" }), "index.js": "x" }, /Webmail would refuse it/],
    ["more files than the webmail accepts", { ...plainPlugin("jitsi-meet", "5.0.1"), ...Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}.js`, "x"])) }, /Webmail would refuse it: ZIP has/],
    ["code the scanner blocks", plainPlugin("jitsi-meet", "5.0.2", {}, "eval('1')\n"), /eval/],
  ])("blocks %s", async (_name, content, error) => {
    addRepo("alice/plugins", { refs: { x: sha(8) }, commits: { [sha(8)]: files(content as Record<string, string>) } });
    const { submission } = await web("author-alice", "x");
    await drain();
    expect(sub(submission.id)).toMatchObject({ status: "blocked", error: expect.stringMatching(error) });
  });
});

describe("review", () => {
  const ready = async (version: string, n: number) => {
    addRepo("alice/plugins", { refs: { [`v${version}`]: sha(n) }, commits: { [sha(n)]: Object.fromEntries(Object.entries(plainPlugin("jitsi-meet", version)).map(([k, v]) => [`jitsi-meet/${k}`, v])) } });
    const { submission } = await web("author-alice", `v${version}`);
    await drain();
    expect(sub(submission.id).status).toBe("awaiting_review");
    return submission.id;
  };

  it("needs notes to reject, and the version can be submitted again", async () => {
    const id = await ready("6.0.0", 9);
    await expect(rejectSubmission(id, "staff", " ")).rejects.toMatchObject({ status: 400 });
    await rejectSubmission(id, "staff", "Please explain the network calls");
    expect(sub(id)).toMatchObject({ status: "rejected", reviewNotes: "Please explain the network calls" });
    await expect(ready("6.0.0", 9)).resolves.toBeTruthy();
  });

  it("refuses a second open submission of the same version", async () => {
    const id = await ready("6.1.0", 10);
    await expect(web("author-alice", "v6.1.0")).rejects.toMatchObject({ status: 409, code: "already_submitted" });
    void id;
  });

  it("publishes only once when two reviewers approve at the same time", async () => {
    const id = await ready("6.2.0", 11);
    const results = await Promise.allSettled([approveSubmission(id, "staff", null), approveSubmission(id, "staff", null)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    await drain();
    expect(db.select().from(extensionVersions).where(and(eq(extensionVersions.extensionId, "ext-jitsi"), eq(extensionVersions.version, "6.2.0"))).all()).toHaveLength(1);
  });

  it("goes back to the reviewer when the author was banned before publishing", async () => {
    const id = await ready("6.3.0", 12);
    await approveSubmission(id, "staff", null);
    await db.update(authors).set({ bannedAt: new Date() }).where(eq(authors.id, "author-alice"));
    await drain();
    await db.update(authors).set({ bannedAt: null }).where(eq(authors.id, "author-alice"));
    expect(sub(id)).toMatchObject({ status: "awaiting_review", error: expect.stringContaining("Publishing failed") });
  });

  it("never approves a dry run", async () => {
    addRepo("alice/plugins", { refs: { x: sha(13) }, commits: { [sha(13)]: Object.fromEntries(Object.entries(plainPlugin("jitsi-meet", "7.0.0")).map(([k, v]) => [`jitsi-meet/${k}`, v])) } });
    const { submission } = await web("author-alice", "x", { dryRun: true });
    await drain();
    expect(sub(submission.id).status).toBe("dry_run_passed");
    await expect(approveSubmission(submission.id, "staff", null)).rejects.toMatchObject({ status: 400 });
  });
});
