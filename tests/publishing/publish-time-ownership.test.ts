// Which rows a publish may go through. A trusted publisher row counts for a
// publish only while its creator could still add it: the creator's GitHub
// account owns the repository named in the token, or the creator is a member
// of the organization author with that GitHub id, or the creator is staff.
// A row that fails this is left out as if it weren't there (the publish gets
// the answer it would get without it) and the audit log records the row's id.
import fs from "fs";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { and, eq } from "drizzle-orm";
import { seed } from "../fixtures/seed";
import { addRepo, fakeSource, plainPlugin, resetFakes, sha } from "../helpers/fake-source";
import { req } from "../helpers/http";

vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  source: () => fakeSource,
}));

const { db } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const { setJwks, GITHUB_ISSUER } = await import("@/lib/auth/oidc");
const { POST: PUBLISH } = await import("@/app/api/v2/publish/route");

let key: CryptoKey;
let n = 0;
async function token(repo: string, repoId: string, ownerId: string, tag: string, commit: string, over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    repository: repo, repository_id: repoId, repository_owner: repo.split("/")[0], repository_owner_id: ownerId,
    workflow_ref: `${repo}/.github/workflows/publish.yml@refs/tags/${tag}`, ref: `refs/tags/${tag}`, ref_type: "tag",
    sha: commit, environment: "release", run_id: "999", run_attempt: "1", actor: "x", event_name: "push", jti: `rv-${++n}`, ...over,
  } as never).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(GITHUB_ISSUER).setAudience("https://extensions.test")
    .setSubject(`repo:${repo}:environment:release`).setIssuedAt(now).setExpirationTime(now + 300).sign(key);
}
const publish = async (t: string, subpath: string) => {
  const res = await PUBLISH(req("/api/v2/publish", { method: "POST", body: { subpath }, headers: { authorization: `Bearer ${t}`, "x-forwarded-for": `10.0.0.${n}` } }));
  const body = await res.json();
  return { status: res.status, code: body.error?.code as string | undefined, id: body.data?.id as string | undefined };
};
const folder = (dir: string, id: string, version: string) =>
  Object.fromEntries(Object.entries(plainPlugin(id, version)).map(([k, v]) => [`${dir}/${k}`, v]));
const subsOf = (extensionId: string) => db.select().from(schema.submissions).where(eq(schema.submissions.extensionId, extensionId)).all();

beforeAll(async () => {
  await seed();
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey as CryptoKey;
  setJwks({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
  await db.insert(schema.authors).values([
    { id: "mallory", githubId: 6001, githubLogin: "mallory", displayName: "Mallory" },
    { id: "carol", githubId: 6101, githubLogin: "carol", displayName: "Carol" },
  ]);
  // carol's own repository carol/tools (ids 600 / 6101) and her extension carol-tool built from it.
  await db.insert(schema.extensions).values([
    { id: "ext-carol", slug: "carol-tool", name: "Carol tool", type: "plugin", pluginType: "hook", authorId: "carol", description: "x",
      githubRepo: "carol/tools", sourceRepoId: "600", subpath: "carol-tool", status: "pending", reservedAt: new Date() },
    // The name of carol's next plugin, reserved by mallory before carol.
    { id: "ext-squat", slug: "carol-next", name: "Carol next", type: "plugin", pluginType: "hook", authorId: "mallory", description: "x",
      githubRepo: "mallory/stuff", subpath: "", status: "pending", reservedAt: new Date() },
    { id: "ext-mal", slug: "mallory-ext", name: "Mallory", type: "plugin", pluginType: "hook", authorId: "mallory", description: "x",
      githubRepo: "mallory/stuff", sourceRepoId: "333", subpath: "", status: "pending", reservedAt: new Date() },
  ]);
  await db.insert(schema.extensionMembers).values([
    { extensionId: "ext-carol", authorId: "carol", role: "owner" },
    { extensionId: "ext-squat", authorId: "mallory", role: "owner" },
    { extensionId: "ext-mal", authorId: "mallory", role: "owner" },
  ]);
  await db.insert(schema.publishers).values([
    { id: "pub-carol", extensionId: "ext-carol", repository: "carol/tools", repositoryId: "600", repositoryOwnerId: "6101",
      workflowPath: ".github/workflows/publish.yml", environment: "release", subpath: "carol-tool", allowedRefs: "tags", createdBy: "carol" },
    { id: "pub-mal", extensionId: "ext-mal", repository: "mallory/stuff", repositoryId: "333", repositoryOwnerId: "6001",
      workflowPath: ".github/workflows/publish.yml", environment: null, subpath: "", allowedRefs: "tags", createdBy: "mallory" },
  ]);
});

beforeEach(() => {
  resetFakes();
  db.delete(schema.rateLimits).run();
  addRepo("carol/tools", {
    info: { id: "600", ownerId: "6101" } as never, refs: {},
    commits: {
      [sha(81)]: folder("carol-tool", "carol-tool", "1.0.0"),
      [sha(82)]: folder("carol-next", "carol-next", "1.0.0"),
      [sha(83)]: { "carol-tool/manifest.json": "{ not json", "carol-tool/index.js": "x" },
      [sha(84)]: folder("carol-tool", "carol-tool", "1.1.0"),
    },
  });
  addRepo("mallory/stuff", {
    info: { id: "333", ownerId: "6001" } as never, refs: {},
    commits: { [sha(85)]: plainPlugin("carol-tool", "9.9.9") },
  });
});

describe("a publish goes only to an extension whose row may publish it", () => {
  it("doesn't match a row once its repository has another owner (transferred)", async () => {
    const r = await publish(await token("carol/tools", "600", "7777", "carol-tool@1.0.0", sha(81)), "carol-tool");
    expect([r.status, r.code]).toEqual([403, "no_publisher"]);
    expect(subsOf("ext-carol")).toEqual([]);
  });

  it("doesn't put another extension's manifest id from your own repository into that extension", async () => {
    const r = await publish(await token("mallory/stuff", "333", "6001", "v9", sha(85)), "");
    expect(r.status).not.toBe(202);
    expect(subsOf("ext-carol")).toEqual([]);
    expect(subsOf("ext-mal")).toEqual([]);
  });

  it("can't win the stored-source fallback with an unreadable manifest and a repointed source", async () => {
    // mallory points her extension's source at carol's folder (any maintainer may, at once) and has
    // a row for carol's folder that was stored without carol.
    db.update(schema.extensions).set({ githubRepo: "carol/tools", sourceRepoId: "600", subpath: "carol-tool" }).where(eq(schema.extensions.id, "ext-squat")).run();
    db.insert(schema.publishers).values({ id: "pub-old-1", extensionId: "ext-squat", repository: "carol/tools", repositoryId: "600", repositoryOwnerId: "6101",
      workflowPath: ".github/workflows/publish.yml", environment: null, subpath: "carol-tool", allowedRefs: "tags", createdBy: "mallory" }).run();
    try {
      const r = await publish(await token("carol/tools", "600", "6101", "carol-tool@1.0.1", sha(83)), "carol-tool");
      expect(r.status).not.toBe(202);
      expect(subsOf("ext-squat")).toEqual([]);
      // With a readable manifest the folder's id decides, and carol's publish lands on her extension.
      const ok = await publish(await token("carol/tools", "600", "6101", "carol-tool@1.1.0", sha(84)), "carol-tool");
      expect(ok.status).toBe(202);
      expect(subsOf("ext-carol").map((s) => s.authorId)).toEqual(["carol"]);
    } finally {
      db.delete(schema.publishers).where(eq(schema.publishers.id, "pub-old-1")).run();
      db.update(schema.extensions).set({ githubRepo: "mallory/stuff", sourceRepoId: null, subpath: "" }).where(eq(schema.extensions.id, "ext-squat")).run();
    }
  });

  // A member of an organization author may add a row for the organization's repository on an
  // extension of their own; the row stays when they leave the organization.
  it("doesn't let a former member's row on their own extension receive the organization's publish", async () => {
    db.insert(schema.authors).values({ id: "org-carolco", githubId: 6301, githubLogin: "carolco", displayName: "Carolco", kind: "org" }).run();
    addRepo("carolco/plugins", { info: { id: "700", ownerId: "6301" } as never, refs: {}, commits: { [sha(86)]: folder("carol-next", "carol-next", "2.0.0") } });
    // mallory was a member when she added the row, then left.
    db.insert(schema.publishers).values({ id: "pub-old-3", extensionId: "ext-squat", repository: "carolco/plugins", repositoryId: "700", repositoryOwnerId: "6301",
      workflowPath: ".github/workflows/publish.yml", environment: null, subpath: "carol-next", allowedRefs: "tags", createdBy: "mallory" }).run();
    try {
      const r = await publish(await token("carolco/plugins", "700", "6301", "carol-next@2.0.0", sha(86)), "carol-next");
      expect(db.select().from(schema.submissions).where(and(eq(schema.submissions.extensionId, "ext-squat"), eq(schema.submissions.githubRepo, "carolco/plugins"))).all()).toEqual([]);
      // The organization has no other row, so the answer is the one without any row.
      expect([r.status, r.code]).toEqual([403, "no_publisher"]);
    } finally {
      db.delete(schema.publishers).where(eq(schema.publishers.id, "pub-old-3")).run();
    }
  });

  it("the staff query lists exactly the rows the rule wouldn't allow", () => {
    db.insert(schema.authors).values([
      { id: "staffer", githubId: 6401, githubLogin: "staffer", displayName: "Staffer", role: "admin" },
      { id: "org-q", githubId: 6501, githubLogin: "q", displayName: "Q", kind: "org" },
      { id: "member-q", githubId: 6502, githubLogin: "mq", displayName: "MQ" },
      { id: "former-q", githubId: 6503, githubLogin: "fq", displayName: "FQ" },
    ]).run();
    db.insert(schema.orgMembers).values({ orgId: "org-q", authorId: "member-q", role: "member" }).run();
    const row = (id: string, createdBy: string, ownerId: string) => ({ id, extensionId: "ext-mal", repository: "x/y", repositoryId: `r-${id}`, repositoryOwnerId: ownerId,
      workflowPath: ".github/workflows/publish.yml", environment: null, subpath: id, allowedRefs: "tags" as const, createdBy });
    db.insert(schema.publishers).values([
      row("q-foreign", "mallory", "6101"), // mallory, carol's repository: listed
      row("q-own", "mallory", "6001"), // mallory's own repository: not listed
      row("q-staff", "staffer", "6101"), // an admin's row: not listed
      row("q-member", "member-q", "6501"), // a member's row for the org's repository: not listed
      row("q-former", "former-q", "6501"), // no longer a member: listed
    ]).run();
    db.insert(schema.publishers).values({ ...row("q-disabled", "mallory", "6101"), disabledAt: new Date() }).run();
    const listed = (db.$client.prepare(`
      select p.id, e.slug, p.repository, p.repository_owner_id, a.github_login
      from publishers p
      join extensions e on e.id = p.extension_id
      join authors a on a.id = p.created_by
      where p.disabled_at is null
        and a.role not in ('admin', 'super_admin')
        and cast(a.github_id as text) <> p.repository_owner_id
        and not exists (
          select 1 from org_members m join authors o on o.id = m.org_id
          where m.author_id = p.created_by and o.kind = 'org' and cast(o.github_id as text) = p.repository_owner_id
        );`).all() as { id: string }[]).map((r) => r.id).filter((id) => id.startsWith("q-")).sort();
    expect(listed).toEqual(["q-foreign", "q-former"]);
  });

  // A row stored without the repository's owner, on a name its creator reserved first.
  it("doesn't let a row stored by an account that doesn't own the repository receive its publish", async () => {
    db.insert(schema.publishers).values({ id: "pub-old-2", extensionId: "ext-squat", repository: "carol/tools", repositoryId: "600", repositoryOwnerId: "6101",
      workflowPath: ".github/workflows/publish.yml", environment: null, subpath: "carol-next", allowedRefs: "tags", createdBy: "mallory" }).run();
    try {
      await publish(await token("carol/tools", "600", "6101", "carol-next@1.0.0", sha(82)), "carol-next");
      expect(db.select().from(schema.submissions).where(and(eq(schema.submissions.extensionId, "ext-squat"), eq(schema.submissions.githubRepo, "carol/tools"))).all()).toEqual([]);
    } finally {
      db.delete(schema.publishers).where(eq(schema.publishers.id, "pub-old-2")).run();
    }
  });

  it("answers such a publish as if the row weren't there", async () => {
    db.insert(schema.publishers).values({ id: "pub-old-4", extensionId: "ext-squat", repository: "carol/tools", repositoryId: "600", repositoryOwnerId: "6101",
      workflowPath: ".github/workflows/publish.yml", environment: null, subpath: "carol-next", allowedRefs: "tags", createdBy: "mallory" }).run();
    try {
      // carol's only row is for another folder.
      const r = await publish(await token("carol/tools", "600", "6101", "carol-next@1.0.0", sha(82)), "carol-next");
      expect([r.status, r.code]).toEqual([403, "wrong_subpath"]);
    } finally {
      db.delete(schema.publishers).where(eq(schema.publishers.id, "pub-old-4")).run();
    }
  });
});

describe("the official plugins' rows from migration 0004", () => {
  const ORG = "e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4";
  const LINUS = "b99d8e35-0a4a-49da-b768-689c7125bd3c";
  const official = (tag: string, commit: string) => token("bulwarkmail/plugins", "1191052237", "266882946", tag, commit, { environment: "extensions" });

  beforeAll(() => {
    // The account the migration names, without a staff role, so only its organization
    // membership can carry the rows. Then the migration's data steps, as they ran.
    db.insert(schema.authors).values({ id: LINUS, githubId: 100, githubLogin: "rathlinus", displayName: "Linus Rath" }).run();
    const migration = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "drizzle", "migrations", "0004_org_owners.sql"), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (/\b(ALTER TABLE|CREATE TABLE|CREATE INDEX)\b/i.test(statement)) continue;
      db.$client.exec(statement);
    }
  });

  beforeEach(() => {
    addRepo("bulwarkmail/plugins", {
      info: { id: "1191052237", ownerId: "266882946" } as never, refs: {},
      commits: { [sha(87)]: folder("auto-tag", "auto-tag", "1.0.0"), [sha(88)]: folder("parcels", "parcels", "1.0.0") },
    });
  });

  it("still publish through the organization member who added them", async () => {
    const rows = db.select().from(schema.publishers).where(eq(schema.publishers.repositoryId, "1191052237")).all();
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((p) => p.createdBy))).toEqual(new Set([LINUS]));
    const r = await publish(await official("auto-tag@1.0.0", sha(87)), "auto-tag");
    expect([r.status, r.code]).toEqual([202, undefined]);
    expect(db.select().from(schema.submissions).where(eq(schema.submissions.id, r.id!)).get()).toMatchObject({ authorId: LINUS, slug: "auto-tag", submittedVia: "oidc" });
  });

  it("stop matching once that member has left the organization, and the audit log names each row", async () => {
    db.delete(schema.orgMembers).where(and(eq(schema.orgMembers.orgId, ORG), eq(schema.orgMembers.authorId, LINUS))).run();
    try {
      const t = await official("parcels@1.0.0", sha(88));
      const r = await publish(t, "parcels");
      expect([r.status, r.code]).toEqual([403, "no_publisher"]);
      const parcels = db.select({ id: schema.publishers.id }).from(schema.publishers).innerJoin(schema.extensions, eq(schema.extensions.id, schema.publishers.extensionId))
        .where(eq(schema.extensions.slug, "parcels")).get()!;
      const logged = db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "publisher.skip"), eq(schema.auditLog.targetId, parcels.id))).all();
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ actorKind: "system", targetKind: "publisher", details: { slug: "parcels", createdBy: LINUS } });
      // Nothing of the token goes into the log.
      expect(JSON.stringify(logged)).not.toContain(t.split(".")[1]);
      expect(JSON.stringify(logged)).not.toContain(t.split(".")[2]);
    } finally {
      db.insert(schema.orgMembers).values({ orgId: ORG, authorId: LINUS, role: "owner" }).run();
    }
  });
});
