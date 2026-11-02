// 0007_reserve_languagetool applied to a database shaped like production's
// (organization set up by 0004), to one where the slug is taken, and to an
// empty one.
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

const MIGRATIONS = path.join(import.meta.dirname, "..", "drizzle", "migrations");
const ORG = "e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4";
const LINUS = "b99d8e35-0a4a-49da-b768-689c7125bd3c";

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

// Up to 0005 with rathlinus in the organization, then the setup, then 0007.
function migrated(setup: (db: Database.Database) => void): Database.Database {
  const db = freshDb();
  migrate(drizzle(db), { migrationsFolder: migrationsUpTo(3) });
  db.prepare("insert into authors (id, github_id, github_login, display_name, role, created_at, updated_at) values (?, 100, 'rathlinus', 'Linus Rath', 'super_admin', 1, 1)").run(LINUS);
  migrate(drizzle(db), { migrationsFolder: migrationsUpTo(5) });
  setup(db);
  migrate(drizzle(db), { migrationsFolder: MIGRATIONS });
  return db;
}

describe("0007_reserve_languagetool", () => {
  it("reserves languagetool for the organization with rathlinus as owner and one trusted publisher", () => {
    const db = migrated(() => {});
    const ext = db.prepare("select id, name, type, plugin_type, author_id, status, github_repo, subpath, source_host, license, reserved_at from extensions where slug = 'languagetool'").get() as Record<string, unknown>;
    expect(ext).toMatchObject({
      name: "Proofreading (LanguageTool)", type: "plugin", plugin_type: "ui-extension", author_id: ORG, status: "pending",
      github_repo: "bulwarkmail/plugins", subpath: "languagetool", source_host: "github.com", license: "AGPL-3.0",
    });
    expect(ext.reserved_at).toBeGreaterThan(0);
    expect(db.prepare("select author_id, role from extension_members where extension_id = ?").all(ext.id)).toEqual([{ author_id: LINUS, role: "owner" }]);
    expect(db.prepare("select repository, repository_id, repository_owner_id, workflow_path, environment, subpath, allowed_refs, created_by from publishers where extension_id = ?").all(ext.id)).toEqual([{
      repository: "bulwarkmail/plugins", repository_id: "1191052237", repository_owner_id: "266882946", workflow_path: ".github/workflows/publish.yml",
      environment: "extensions", subpath: "languagetool", allowed_refs: "tags", created_by: LINUS,
    }]);
  });

  it("leaves a languagetool someone else already holds alone", () => {
    const db = migrated((d) => {
      d.prepare("insert into authors (id, github_id, github_login, display_name, created_at, updated_at) values ('paul', 200, 'paulhenry46', 'Paul', 1, 1)").run();
      d.prepare("insert into extensions (id, slug, name, type, plugin_type, author_id, description, github_repo, subpath, status, created_at, updated_at) values ('e-paul', 'languagetool', 'Mine', 'plugin', 'ui-extension', 'paul', 'd', 'paulhenry46/lt', '', 'approved', 10, 20)").run();
    });
    expect(db.prepare("select id, author_id from extensions where slug = 'languagetool'").all()).toEqual([{ id: "e-paul", author_id: "paul" }]);
    expect(db.prepare("select count(*) n from publishers where subpath = 'languagetool' or extension_id = 'e-paul'").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) n from extension_members where extension_id = 'e-paul'").get()).toEqual({ n: 0 });
  });

  it("adds nothing to an empty database", () => {
    const db = freshDb();
    migrate(drizzle(db), { migrationsFolder: MIGRATIONS });
    expect(db.prepare("select count(*) n from extensions").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) n from publishers").get()).toEqual({ n: 0 });
  });
});
