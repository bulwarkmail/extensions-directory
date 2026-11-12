// What a plugin is granted, as the reviewer and the listing see it. A webmail
// grants the optional permissions it knows like the others, and also acts on
// the tier, the three origin lists and the servers named under credentials.
// The review highlights, the listing API and the public page have to say all
// of it.
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { params, req, BASE } from "./helpers/http";
import { signOut } from "./helpers/session";
import { addRepo, fakeSource, resetFakes, sha } from "./helpers/fake-source";

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
const { diffBundles } = await import("@/lib/pipeline/diff");
const { validateManifest } = await import("@/lib/manifest");
const { checkBundle, grantOf } = await import("@/lib/webmail-compat");
const { refreshLatest } = await import("@/lib/release-caches");
const v1Detail = await import("@/app/api/v1/extension/[slug]/route");

const dispatch = router(v2Routes);
const get = async (p: string) => {
  const res = await dispatch("GET")(req(`/api/v2${p}`, { headers: { origin: new URL(BASE).origin } }));
  return (await res.json()).data;
};
const post = async (p: string, body: unknown) => {
  const res = await dispatch("POST")(req(`/api/v2${p}`, { method: "POST", body, headers: { origin: new URL(BASE).origin } }));
  return (await res.json()).data;
};

const manifestOf = (id: string, version: string, extra: Record<string, unknown>) =>
  ({ id, name: id, version, author: "Test", description: "Adds one button to the toolbar.", type: "ui-extension", entrypoint: "index.js", ...extra });
const files = (m: Record<string, unknown>) => ({ "manifest.json": JSON.stringify(m), "index.js": "module.exports = { activate() {} };\n" });

async function drain() {
  while (await runOnce()) { /* every queued job */ }
}

let commitNo = 100;
/** Submit `extra` as version `version` of `id` and build it; returns the submission row. */
async function submit(id: string, extra: Record<string, unknown>, version = "1.0.0") {
  const commit = sha(commitNo++);
  const tag = `v${version}`;
  addRepo(`dana/${id}`, { refs: { [tag]: commit }, commits: { [commit]: files(manifestOf(id, version, extra)) } });
  const { submission } = await createSubmission({ authorId: "dana", actor: { kind: "author", id: "dana" }, via: "web", allowCreate: true, host: "github.com", repo: `dana/${id}`, ref: tag, subpath: "", dryRun: false });
  await drain();
  return db.select().from(schema.submissions).where(eq(schema.submissions.id, submission.id)).get()!;
}

async function publish(id: string, extra: Record<string, unknown>, version = "1.0.0") {
  const s = await submit(id, extra, version);
  expect(s.status).toBe("awaiting_review");
  await approveSubmission(s.id, "rev", null);
  await drain();
  return s;
}

/** A plugin that asks for everything a webmail can grant beyond plain permissions. */
const EVERYTHING = {
  tier: "privileged",
  permissions: ["ui:toolbar"],
  optionalPermissions: ["crypto:full", "email:read", "http:proxy", "http:fetch", "calendar:telepathy"],
  httpOrigins: ["https://api.example"],
  apiPostPaths: ["/api/plugin-proxy"],
  frameOrigins: ["https://embed.example"],
  configSchema: {
    baseUrl: { type: "string", label: "Server", default: "https://llm.example/v1" },
    apiKey: { type: "secret", label: "API key" },
  },
  credentials: {
    sync: { label: "Sync", scope: "user", inject: { type: "none" }, origin: "https://sync.example" },
    model: { label: "Model", scope: "admin", inject: { type: "bearer" }, secretKey: "apiKey", originKey: "baseUrl" },
    own: { label: "Own server", scope: "user", inject: { type: "basic" } },
  },
};

const GRANT_FIELDS = ["tier", "httpOrigins", "apiPostPaths", "frameOrigins", "credentialOrigins"] as const;

beforeAll(async () => {
  await db.insert(schema.authors).values([
    { id: "dana", githubId: 4001, githubLogin: "dana", displayName: "Dana" },
    { id: "rev", githubId: 4002, githubLogin: "rev", displayName: "Rev", role: "reviewer" },
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
});

describe("what review and the listing say about a plugin's grants", () => {
  it("points the reviewer at optional permissions", async () => {
    const s = await submit("toolbar-button", { permissions: ["ui:toolbar"], optionalPermissions: ["email:read", "http:fetch"], httpOrigins: ["https://api.example"] });
    expect(s.status).toBe("awaiting_review");
    const diff = s.diffSummary as { permissionsAdded: string[] };
    expect(diff.permissionsAdded).toEqual(expect.arrayContaining(["email:read", "http:fetch", "ui:toolbar"]));
  });

  it("lists optional permissions for the webmail's install dialog and the public page", async () => {
    const s = await submit("mail-reader", { permissions: ["ui:toolbar"], optionalPermissions: ["email:read", "email:send"] });
    await approveSubmission(s.id, "rev", null);
    await drain();
    const listed = await get("/extensions/mail-reader");
    expect(listed.latest.permissions).toEqual(expect.arrayContaining(["email:read", "email:send"]));
    expect(listed.permissions.filter((p: { highRisk: boolean }) => p.highRisk).map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["email:read", "email:send"]));
    const versions = await get("/extensions/mail-reader/versions");
    expect(versions[0].permissions).toEqual(expect.arrayContaining(["email:read", "email:send"]));
  });

  it("points the reviewer at a server a credential is sent to", async () => {
    const s = await submit("sync-plugin", {
      permissions: ["ui:toolbar"], optionalPermissions: ["http:proxy"],
      credentials: { sync: { label: "Sync", scope: "user", inject: { type: "none" }, origin: "https://sync.example" } },
    });
    expect(s.status).toBe("awaiting_review");
    const diff = s.diffSummary as { originsAdded: Record<string, string[]> };
    expect(JSON.stringify(diff.originsAdded)).toContain("https://sync.example");
  });

  it("points the reviewer at the privileged tier on a first version", async () => {
    const s = await submit("signing-plugin", { tier: "privileged", permissions: ["ui:toolbar", "crypto:full"] });
    expect(s.status).toBe("awaiting_review");
    const diff = s.diffSummary as { tierChanged: { from: string | null; to: string | null } | null };
    expect(diff.tierChanged).toEqual({ from: null, to: "privileged" });
  });
});

describe("the grant fields of a listed version", () => {
  it("lists the tier, hosts, routes, embedded sites and credential servers of a plugin that has them all", async () => {
    await publish("all-grants", EVERYTHING);
    const expected = {
      tier: "privileged",
      httpOrigins: ["https://api.example"],
      apiPostPaths: ["/api/plugin-proxy"],
      frameOrigins: ["https://embed.example"],
      // The fixed one and the default of the server the admin sets; a server each user enters is theirs.
      credentialOrigins: ["https://sync.example", "https://llm.example"],
    };
    const detail = await get("/extensions/all-grants");
    const briefs = [
      detail.latest,
      detail.newest,
      ...detail.versions,
      (await get("/extensions?q=all-grants"))[0].latest,
      (await get("/extensions/all-grants/versions"))[0],
      await get("/extensions/all-grants/versions/1.0.0"),
      (await post("/updates", { installed: [{ slug: "all-grants", version: "0.9.0" }] })).updates[0],
    ];
    for (const brief of briefs) {
      expect(brief).toMatchObject(expected);
      expect(brief.permissions).toEqual(expect.arrayContaining(["ui:toolbar", "crypto:full", "email:read", "http:proxy", "http:fetch"]));
      // The webmail leaves out a name it doesn't know, so the listing does too.
      expect(brief.permissions).not.toContain("calendar:telepathy");
    }
    const highRisk = detail.permissions.filter((p: { highRisk: boolean }) => p.highRisk).map((p: { id: string }) => p.id);
    expect(highRisk).toEqual(expect.arrayContaining(["crypto:full", "email:read", "http:proxy", "http:fetch"]));
  });

  it("lists the untrusted tier and empty lists for a plugin that asks for nothing more", async () => {
    await publish("plain-button", { permissions: ["ui:toolbar"] });
    const detail = await get("/extensions/plain-button");
    for (const brief of [detail.latest, ...detail.versions]) {
      expect(brief).toMatchObject({ permissions: ["ui:toolbar"], tier: "untrusted", httpOrigins: [], apiPostPaths: [], frameOrigins: [], credentialOrigins: [] });
    }
  });

  it("says privileged and marks crypto:full high risk when crypto:full is only optional", async () => {
    const s = await publish("optional-crypto", { tier: "privileged", permissions: ["ui:toolbar"], optionalPermissions: ["crypto:full"] });
    expect((s.diffSummary as { tierChanged: unknown }).tierChanged).toEqual({ from: null, to: "privileged" });
    const detail = await get("/extensions/optional-crypto");
    expect(detail.latest.tier).toBe("privileged");
    expect(detail.latest.permissions).toContain("crypto:full");
    expect(detail.permissions).toEqual(expect.arrayContaining([expect.objectContaining({ id: "crypto:full", highRisk: true })]));
  });

  it("stores the granted list with the published version", async () => {
    await publish("stored-grant", { permissions: ["ui:toolbar"], optionalPermissions: ["email:read"] });
    const ext = db.select().from(schema.extensions).where(eq(schema.extensions.slug, "stored-grant")).get()!;
    const row = db.select().from(schema.extensionVersions).where(eq(schema.extensionVersions.extensionId, ext.id)).get()!;
    expect(row.permissions).toEqual(["ui:toolbar", "email:read"]);
    expect(ext.permissions).toEqual(["ui:toolbar", "email:read"]);
  });
});

describe("versions published before optional permissions were counted", () => {
  let n = 0;
  /** A version row as the directory wrote it before: the manifest, and `permissions` alone in the column. */
  function insertOld(slug: string, manifest: Record<string, unknown>, type: "plugin" | "theme" = "plugin") {
    const extId = `ext-old-${++n}`;
    db.insert(schema.extensions).values({ id: extId, slug, name: slug, type, pluginType: type === "plugin" ? "ui-extension" : null, authorId: "dana", description: "Old", githubRepo: `dana/${slug}`, status: "approved", permissions: (manifest.permissions as string[]) ?? [] }).run();
    db.insert(schema.extensionVersions).values({
      id: `ver-old-${n}`, extensionId: extId, version: manifest.version as string, bundlePath: `bundles/${slug}/x.zip`, bundleSha256: "0".repeat(64), bundleSize: 1,
      permissions: (manifest.permissions as string[]) ?? [], manifest, reviewStatus: "approved", channel: "stable", publishedAt: new Date(), createdAt: new Date(),
    }).run();
    return extId;
  }

  it("lists them with the full grant in v2 and v1, without touching the stored row", async () => {
    insertOld("old-reader", manifestOf("old-reader", "2.0.0", {
      permissions: ["ui:toolbar"], optionalPermissions: ["email:read", "settings:write"], httpOrigins: ["https://api.example"],
    }));
    const detail = await get("/extensions/old-reader");
    for (const brief of [detail.latest, ...detail.versions, (await get("/extensions/old-reader/versions"))[0]]) {
      expect(brief.permissions).toEqual(["ui:toolbar", "email:read", "settings:write"]);
      expect(brief.httpOrigins).toEqual(["https://api.example"]);
      expect(brief.tier).toBe("untrusted");
    }
    expect(detail.permissions.map((p: { id: string }) => p.id)).toEqual(["ui:toolbar", "email:read", "settings:write"]);

    const v1 = await (await v1Detail.GET(req("/api/v1/extension/old-reader"), params({ slug: "old-reader" }))).json();
    expect(v1.data.permissions).toEqual(["ui:toolbar", "email:read", "settings:write"]);
    expect(v1.data.latestVersion.permissions).toEqual(["ui:toolbar", "email:read", "settings:write"]);
    expect(v1.data.versions[0].permissions).toEqual(["ui:toolbar", "email:read", "settings:write"]);
    // v1 gets the longer list and nothing else.
    for (const key of GRANT_FIELDS) {
      expect(v1.data).not.toHaveProperty(key);
      expect(v1.data.latestVersion).not.toHaveProperty(key);
    }
  });

  it("writes the granted list into the stored rows when the post-migrate step runs", async () => {
    const extId = insertOld("old-sender", manifestOf("old-sender", "1.0.0", { permissions: ["ui:toolbar"], optionalPermissions: ["email:send"] }));
    const { rederiveStoredPermissions } = await import("@/lib/webmail-compat/grants");
    const sqlite = db.$client;
    expect(rederiveStoredPermissions(sqlite, true)).toBeGreaterThan(0);
    expect(db.select().from(schema.extensionVersions).where(eq(schema.extensionVersions.extensionId, extId)).get()!.permissions).toEqual(["ui:toolbar"]);
    rederiveStoredPermissions(sqlite);
    refreshLatest(sqlite, extId);
    expect(db.select().from(schema.extensionVersions).where(eq(schema.extensionVersions.extensionId, extId)).get()!.permissions).toEqual(["ui:toolbar", "email:send"]);
    expect(db.select().from(schema.extensions).where(eq(schema.extensions.id, extId)).get()!.permissions).toEqual(["ui:toolbar", "email:send"]);
    expect(rederiveStoredPermissions(sqlite)).toBe(0);
  });

  it("lists a theme with no permissions, no tier and empty lists", async () => {
    insertOld("old-theme", { id: "old-theme", name: "Old theme", version: "1.0.0", author: "Test", description: "Colours", type: "theme", permissions: ["email:read"], optionalPermissions: ["http:fetch"] }, "theme");
    const detail = await get("/extensions/old-theme");
    expect(detail.latest).toMatchObject({ permissions: [], tier: null, httpOrigins: [], apiPostPaths: [], frameOrigins: [], credentialOrigins: [] });
    expect(detail.permissions).toEqual([]);
  });
});

describe("the review lines of an update", () => {
  const filesOf = new Map([["index.js", new TextEncoder().encode("x")]]);
  const diff = (before: Record<string, unknown>, after: Record<string, unknown>) =>
    diffBundles({ version: "1.0.0", files: filesOf, manifest: manifestOf("upd", "1.0.0", before) }, { files: filesOf, manifest: manifestOf("upd", "1.0.1", after) });

  it("names an optional permission an update adds, on its own line too", async () => {
    await publish("grows-later", { permissions: ["ui:toolbar"] });
    const s = await submit("grows-later", { permissions: ["ui:toolbar"], optionalPermissions: ["email:read"] }, "1.0.1");
    expect(s.status).toBe("awaiting_review");
    expect(s.diffSummary).toMatchObject({ previousVersion: "1.0.0", permissionsAdded: ["email:read"], optionalPermissionsAdded: ["email:read"] });
  });

  it("names a credential server an update adds when nothing else changes", () => {
    const before = { permissions: ["ui:toolbar", "http:proxy"] };
    const d = diff(before, { ...before, credentials: { sync: { label: "Sync", scope: "user", inject: { type: "none" }, origin: "https://sync.example" } } });
    expect(d.permissionsAdded).toEqual([]);
    expect(d.originsAdded).toEqual({ credentials: ["https://sync.example"] });
  });

  it("names a server the admin sets, with the manifest's default", () => {
    const before = { permissions: ["ui:toolbar"], optionalPermissions: ["http:proxy"], configSchema: EVERYTHING.configSchema };
    const d = diff(before, { ...before, credentials: { model: EVERYTHING.credentials.model } });
    expect(d.originsAdded).toEqual({ credentials: ["set by the admin, default https://llm.example"] });
  });

  it("names a tier change and a new embedded site", () => {
    const d = diff({ permissions: ["ui:toolbar", "crypto:full"] }, { tier: "privileged", permissions: ["ui:toolbar", "crypto:full"], frameOrigins: ["https://embed.example"] });
    expect(d.tierChanged).toEqual({ from: "untrusted", to: "privileged" });
    expect(d.originsAdded).toEqual({ frameOrigins: ["https://embed.example"] });
  });

  it("gives no line when only the code changed", () => {
    const d = diff(EVERYTHING, EVERYTHING);
    expect(d).toMatchObject({ permissionsAdded: [], optionalPermissionsAdded: [], originsAdded: {}, tierChanged: null, keystoreAdded: false });
  });
});

describe("the directory's list and the vendored webmail reader", () => {
  async function zipOf(m: Record<string, unknown>) {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files(m))) zip.file(name, content);
    return zip.generateAsync({ type: "uint8array" });
  }

  it.each([
    ["plain permissions", { permissions: ["ui:toolbar", "email:read"] }],
    ["optional permissions", { permissions: ["ui:toolbar"], optionalPermissions: ["email:read", "email:send", "http:proxy"] }],
    ["an unknown optional name", { permissions: ["ui:toolbar"], optionalPermissions: ["calendar:telepathy", "email:read"] }],
    ["keystore without the privileged tier", { permissions: ["ui:toolbar"], optionalPermissions: ["keystore"] }],
    ["keystore with the privileged tier", { tier: "privileged", permissions: ["crypto:full"], optionalPermissions: ["keystore"] }],
    ["everything", EVERYTHING],
  ])("grant the same for %s", async (_name, extra) => {
    const m = manifestOf("same-list", "1.0.0", extra);
    const read = await checkBundle(await zipOf(m), "plugin", "same-list");
    expect(read.ok).toBe(true);
    const webmail = read.manifest as { permissions: string[]; tier?: string; httpOrigins?: string[]; apiPostPaths?: string[]; frameOrigins?: string[] };
    const grant = grantOf(m);
    expect(grant.checked).toBe(true);
    expect(grant.permissions).toEqual(webmail.permissions);
    expect(grant.tier).toBe(webmail.tier ?? "untrusted");
    expect(grant.httpOrigins).toEqual(webmail.httpOrigins ?? []);
    expect(grant.apiPostPaths).toEqual(webmail.apiPostPaths ?? []);
    expect(grant.frameOrigins).toEqual(webmail.frameOrigins ?? []);
  });

  it("shows the reviewer the optional names the webmail doesn't know", () => {
    expect(grantOf(manifestOf("x", "1.0.0", { optionalPermissions: ["calendar:telepathy", "email:read"] })).unknownOptionalPermissions).toEqual(["calendar:telepathy"]);
  });
});

describe("submission", () => {
  it.each([
    ["a string", "email:read"],
    ["a list with a number", [7, "email:read"]],
    ["an object", { "email:read": true }],
  ])("refuses optionalPermissions that is %s", async (_name, value) => {
    expect(validateManifest(manifestOf("junk", "1.0.0", { optionalPermissions: value }))).toEqual({ ok: false, error: "'optionalPermissions' must be a list of strings" });
    addRepo("dana/junk", { refs: { "v1.0.0": sha(9) }, commits: { [sha(9)]: files(manifestOf("junk", "1.0.0", { optionalPermissions: value })) } });
    await expect(createSubmission({ authorId: "dana", actor: { kind: "author", id: "dana" }, via: "web", allowCreate: true, host: "github.com", repo: "dana/junk", ref: "v1.0.0", subpath: "", dryRun: false }))
      .rejects.toMatchObject({ status: 400, code: "bad_manifest" });
  });

  it("refuses permissions that is not a list of strings", () => {
    expect(validateManifest(manifestOf("junk", "1.0.0", { permissions: "email:read" }))).toMatchObject({ ok: false });
  });
});
