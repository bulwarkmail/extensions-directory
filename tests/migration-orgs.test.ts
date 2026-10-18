// 0004_org_owners applied to a database in the shape before it (0000-0003)
// holding rows like production's, and to an empty one.
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = path.join(import.meta.dirname, "..", "drizzle", "migrations");
const ORG = "e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4";
const LINUS = "b99d8e35-0a4a-49da-b768-689c7125bd3c";
const NEW_SLUGS = ["ai-assistant", "auto-tag", "birthdays", "email-stats", "email-to-task", "nextcloud", "outlook-style-headers", "paperless", "parcels", "reply-all-guardrail", "timezones", "translate"];

function migrationsUpTo(idx: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extdir-migrations-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= idx);
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal));
  for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

function freshDb(): Database.Database {
  return new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "extdir-migration-")), "x.db"));
}

let sqlite: Database.Database;
const one = <T>(s: string, ...p: unknown[]) => sqlite.prepare(s).get(...p) as T;
const all = <T>(s: string, ...p: unknown[]) => sqlite.prepare(s).all(...p) as T[];

beforeAll(() => {
  sqlite = freshDb();
  migrate(drizzle(sqlite), { migrationsFolder: migrationsUpTo(3) });
  const run = (s: string, ...p: unknown[]) => sqlite.prepare(s).run(...p);
  run("insert into authors (id, github_id, github_login, display_name, role, created_at, updated_at) values (?, 100, 'rathlinus', 'Linus Rath', 'super_admin', 1, 1)", LINUS);
  run("insert into authors (id, github_id, github_login, display_name, created_at, updated_at) values ('paul', 200, 'paulhenry46', 'Paul', 1, 1)");
  const ext = (id: string, slug: string, author: string, repo: string, subpath: string, status = "approved") => {
    run("insert into extensions (id, slug, name, type, plugin_type, author_id, description, github_repo, subpath, status, created_at, updated_at) values (?, ?, ?, 'plugin', 'hook', ?, 'd', ?, ?, ?, 10, 20)",
      id, slug, slug, author, repo, subpath, status);
    run("insert into extension_members (extension_id, author_id, role, created_at) values (?, ?, 'owner', 10)", id, author);
  };
  ext("e-cal", "calendar-agenda", LINUS, "bulwarkmail/plugins", "calendar-agenda");
  ext("e-jitsi", "jitsi-meet", LINUS, "bulwarkmail/plugins", "");
  ext("e-notes", "quick-notes", LINUS, "bulwarkmail/plugins", "");
  ext("e-mail", "external-mail-warning", LINUS, "bulwarkmail/plugins", "external-mail-warning");
  ext("e-rcpt", "external-recipient-warning", LINUS, "bulwarkmail/plugins", "external-mail-warning");
  ext("e-subway", "subway-surfers", LINUS, "rathlinus/subway-surfers-bulwark", "");
  // Someone else's, including one with a name the migration would reserve.
  ext("e-paul", "pgp-thing", "paul", "paulhenry46/pgp", "");
  ext("e-paul-tz", "timezones", "paul", "paulhenry46/tz", "", "pending");
  // A maintainer on one of Linus's extensions stays one.
  run("insert into extension_members (extension_id, author_id, role, created_at) values ('e-cal', 'paul', 'maintainer', 10)");

  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS });
});

describe("0004_org_owners", () => {
  it("creates the Bulwark organization with rathlinus as its owner", () => {
    expect(one("select github_id, github_login, display_name, avatar_url, verified, kind from authors where id = ?", ORG)).toEqual({
      github_id: 266882946, github_login: "bulwarkmail", display_name: "Bulwark", avatar_url: "https://avatars.githubusercontent.com/u/266882946?v=4", verified: 1, kind: "org",
    });
    expect(all("select kind from authors where id in (?, 'paul')", LINUS)).toEqual([{ kind: "user" }, { kind: "user" }]);
    expect(all("select org_id, author_id, role from org_members")).toEqual([{ org_id: ORG, author_id: LINUS, role: "owner" }]);
  });

  it("moves exactly rathlinus's extensions to it and keeps their members", () => {
    expect(all("select slug from extensions where author_id = ? and created_at = 10 order by slug", ORG).map((r) => (r as { slug: string }).slug)).toEqual([
      "calendar-agenda", "external-mail-warning", "external-recipient-warning", "jitsi-meet", "quick-notes", "subway-surfers",
    ]);
    expect(all("select slug, author_id from extensions where author_id in (?, 'paul') order by slug", LINUS)).toEqual([
      { slug: "pgp-thing", author_id: "paul" }, { slug: "timezones", author_id: "paul" },
    ]);
    expect(all("select extension_id, author_id, role from extension_members where extension_id = 'e-cal' order by author_id")).toEqual([
      { extension_id: "e-cal", author_id: LINUS, role: "owner" }, { extension_id: "e-cal", author_id: "paul", role: "maintainer" },
    ]);
    expect(one("select updated_at from extensions where id = 'e-cal'")).toEqual({ updated_at: 20 });
  });

  it("gives jitsi-meet and quick-notes their folder", () => {
    expect(all("select slug, subpath from extensions where id in ('e-jitsi', 'e-notes', 'e-subway') order by slug")).toEqual([
      { slug: "jitsi-meet", subpath: "jitsi-meet" }, { slug: "quick-notes", subpath: "quick-notes" }, { slug: "subway-surfers", subpath: "" },
    ]);
  });

  it("reserves the official plugins that aren't taken, from their manifests", () => {
    const rows = all<{ slug: string; name: string; type: string; plugin_type: string; status: string; github_repo: string; source_host: string; subpath: string; license: string; reserved_at: number | null }>(
      "select slug, name, type, plugin_type, status, github_repo, source_host, subpath, license, reserved_at from extensions where author_id = ? and created_at <> 10 order by slug", ORG);
    expect(rows.map((r) => r.slug)).toEqual(NEW_SLUGS.filter((s) => s !== "timezones"));
    for (const r of rows) {
      expect(r).toMatchObject({ type: "plugin", status: "pending", github_repo: "bulwarkmail/plugins", source_host: "github.com", subpath: r.slug, license: "AGPL-3.0" });
      expect(r.reserved_at).toBeGreaterThan(0);
    }
    expect(rows.find((r) => r.slug === "email-to-task")).toMatchObject({ name: "Email to task", plugin_type: "ui-extension" });
    expect(rows.find((r) => r.slug === "birthdays")).toMatchObject({ name: "Birthday reminders", plugin_type: "sidebar-app" });
    expect(rows.find((r) => r.slug === "auto-tag")).toMatchObject({ name: "Auto Tag", plugin_type: "hook" });
    expect(one("select description from extensions where slug = 'email-to-task'")).toEqual({ description: expect.stringContaining("Bulwark's own tasks") });
    expect(all("select e.slug from extension_members m join extensions e on e.id = m.extension_id where m.author_id = ? and e.created_at <> 10 order by e.slug", LINUS).length).toBe(11);
    expect(one("select author_id from extensions where slug = 'timezones'")).toEqual({ author_id: "paul" });
  });

  it("adds one trusted publisher per plugins folder of the organization", () => {
    const rows = all<Record<string, unknown>>("select e.slug, p.repository, p.repository_id, p.repository_owner_id, p.workflow_path, p.environment, p.subpath, p.allowed_refs, p.created_by from publishers p join extensions e on e.id = p.extension_id order by e.slug");
    expect(rows.map((r) => r.slug)).toEqual([
      "ai-assistant", "auto-tag", "birthdays", "calendar-agenda", "email-stats", "email-to-task", "external-mail-warning", "jitsi-meet", "nextcloud",
      "outlook-style-headers", "paperless", "parcels", "quick-notes", "reply-all-guardrail", "translate",
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({
        repository: "bulwarkmail/plugins", repository_id: "1191052237", repository_owner_id: "266882946", workflow_path: ".github/workflows/publish.yml",
        environment: "extensions", subpath: r.slug, allowed_refs: "tags", created_by: LINUS,
      });
    }
  });
});

describe("0004_org_owners on an empty database", () => {
  it("only creates the organization", () => {
    const db = freshDb();
    migrate(drizzle(db), { migrationsFolder: MIGRATIONS });
    expect(db.prepare("select github_login, kind from authors").all()).toEqual([{ github_login: "bulwarkmail", kind: "org" }]);
    expect(db.prepare("select count(*) n from extensions").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) n from org_members").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) n from publishers").get()).toEqual({ n: 0 });
  });
});
