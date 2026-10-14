// 0003_publishing applied to a database in the pre-rework shape (0000-0002),
// then the post-migrate data steps.
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { refreshLatest } from "@/lib/release-caches";
import { verifyData } from "@/lib/verify-data";

const MIGRATIONS = path.join(import.meta.dirname, "..", "drizzle", "migrations");
let sqlite: Database.Database;
let uploads: string;

function oldMigrationsFolder(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extdir-old-migrations-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 2);
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal));
  for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extdir-migration-"));
  uploads = path.join(dir, "uploads");
  sqlite = new Database(path.join(dir, "old.db"));
  migrate(drizzle(sqlite), { migrationsFolder: oldMigrationsFolder() });

  const run = (s: string, ...p: unknown[]) => sqlite.prepare(s).run(...p);
  run("insert into authors (id, github_id, github_login, display_name, banned, created_at, updated_at) values ('a1', 1, 'alice', 'Alice', 0, 100, 100)");
  run("insert into authors (id, github_id, github_login, display_name, banned, created_at, updated_at) values ('a2', 2, 'mallory', 'Mallory', 1, 100, 200)");
  // A reviewer who never had an author row, and an admin who did.
  run("insert into directory_admins (id, github_id, github_login, display_name, role, created_at) values ('d1', 9, 'rev', 'Rev', 'reviewer', 50)");
  run("insert into directory_admins (id, github_id, github_login, display_name, role, created_at) values ('d2', 1, 'alice', 'Alice', 'super_admin', 50)");
  run("insert into extensions (id, slug, name, type, author_id, description, github_repo, status, created_at, updated_at, total_downloads) values ('e1', 'tool', 'Tool', 'plugin', 'a1', 'd', 'alice/tool', 'approved', 100, 100, 3)");
  run("insert into extensions (id, slug, name, type, author_id, description, github_repo, status, created_at, updated_at) values ('e2', 'draft', 'Draft', 'plugin', 'a1', 'd', 'alice/draft', 'pending', 300, 300)");
  for (const [id, v, at] of [["v1", "1.0.0", 100], ["v2", "1.10.0", 200], ["v3", "1.9.0", 300], ["v4", "2.0.0-beta.1", 400]] as const) {
    fs.mkdirSync(path.join(uploads, "bundles/tool", v), { recursive: true });
    fs.writeFileSync(path.join(uploads, `bundles/tool/${v}/tool-${v}.zip`), `zip ${v}`);
    const sha = require("crypto").createHash("sha256").update(`zip ${v}`).digest("hex");
    run("insert into extension_versions (id, extension_id, version, changelog, bundle_path, bundle_sha256, bundle_size, manifest, review_status, reviewer_id, created_at, permissions, min_app_version) values (?, 'e1', ?, ?, ?, ?, 5, '{}', 'approved', 'd1', ?, ?, ?)",
      id, v, v === "1.0.0" ? null : "notes", `bundles/tool/${v}/tool-${v}.zip`, sha, at, JSON.stringify([`perm:${v}`]), `1.${at / 100}.0`);
    run("insert into submissions (id, extension_id, version_id, author_id, type, github_repo, github_tag, subpath, manifest_snapshot, status, submitted_at, reviewer_id) values (?, 'e1', ?, 'a1', 'new_version', 'alice/tool', ?, 'sub', ?, 'approved', ?, 'd1')",
      `s-${id}`, id, `v${v}`, JSON.stringify({ id: "tool", version: v }), at);
  }
  run("insert into download_stats (id, extension_id, version_id, downloaded_at, ip_hash) values ('x1', 'e1', 'v1', 86400, 'a'), ('x2', 'e1', 'v1', 86401, 'b'), ('x3', 'e1', 'v2', 172800, 'a')");
  // Two open submissions of the same version (only possible before the rework), and one in review.
  run("insert into submissions (id, extension_id, author_id, type, github_repo, github_tag, manifest_snapshot, status, submitted_at) values ('open-old', 'e1', 'a1', 'new_version', 'alice/tool', 'main', ?, 'pending', 500)", JSON.stringify({ id: "tool", version: "3.0.0" }));
  run("insert into submissions (id, extension_id, author_id, type, github_repo, github_tag, manifest_snapshot, status, submitted_at) values ('open-new', 'e1', 'a1', 'new_version', 'alice/tool', 'main', ?, 'review', 600)", JSON.stringify({ id: "tool", version: "3.0.0" }));
  run("insert into submissions (id, extension_id, author_id, type, github_repo, github_tag, manifest_snapshot, status, submitted_at) values ('rej', 'e1', 'a2', 'new_version', 'm/x', 'main', ?, 'rejected', 700)", JSON.stringify({ id: "tool", version: "4.0.0" }));

  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS });
  refreshLatest(sqlite);
});

const one = <T>(s: string, ...p: unknown[]) => sqlite.prepare(s).get(...p) as T;
const all = <T>(s: string, ...p: unknown[]) => sqlite.prepare(s).all(...p) as T[];

describe("0003_publishing", () => {
  it("moves staff roles onto author rows, creating missing authors", () => {
    expect(all("select github_login, role from authors order by github_id")).toEqual([
      { github_login: "alice", role: "super_admin" },
      { github_login: "mallory", role: "author" },
      { github_login: "rev", role: "reviewer" },
    ]);
    const rev = one<{ id: string }>("select id from authors where github_login = 'rev'");
    expect(one("select author_id from directory_admins where id = 'd1'")).toEqual({ author_id: rev.id });
  });

  it("keeps bans", () => {
    expect(one("select banned, banned_at from authors where id = 'a2'")).toEqual({ banned: 1, banned_at: 200 });
  });

  it("makes each extension's author its owner and starts the reservation clock", () => {
    expect(all("select extension_id, author_id, role from extension_members order by extension_id")).toEqual([
      { extension_id: "e1", author_id: "a1", role: "owner" },
      { extension_id: "e2", author_id: "a1", role: "owner" },
    ]);
    expect(one("select reserved_at from extensions where id = 'e2'")).toEqual({ reserved_at: 300 });
    expect(one("select reserved_at from extensions where id = 'e1'")).toEqual({ reserved_at: null });
  });

  it("records where each version came from and who reviewed it", () => {
    const rev = one<{ id: string }>("select id from authors where github_login = 'rev'");
    expect(one("select channel, submission_id, source_repo, source_ref, source_subpath, submitted_by, submitted_via, reviewed_by, changelog_source from extension_versions where id = 'v2'")).toEqual({
      channel: "stable", submission_id: "s-v2", source_repo: "alice/tool", source_ref: "v1.10.0", source_subpath: "sub",
      submitted_by: "a1", submitted_via: "legacy", reviewed_by: rev.id, changelog_source: "legacy",
    });
    expect(one("select channel from extension_versions where id = 'v4'")).toEqual({ channel: "beta" });
    expect(one("select changelog_source from extension_versions where id = 'v1'")).toEqual({ changelog_source: null });
  });

  it("carries download counts per version and per day", () => {
    expect(all("select id, download_count from extension_versions order by id")).toEqual([
      { id: "v1", download_count: 2 }, { id: "v2", download_count: 1 }, { id: "v3", download_count: 0 }, { id: "v4", download_count: 0 },
    ]);
    expect(all("select version_id, day, count from download_daily order by day")).toEqual([
      { version_id: "v1", day: "1970-01-02", count: 2 },
      { version_id: "v2", day: "1970-01-03", count: 1 },
    ]);
    expect(one("select total_downloads from extensions where id = 'e1'")).toEqual({ total_downloads: 3 });
  });

  it("puts open submissions back in the queue, keeping only the newest of a version", () => {
    expect(all("select id, status, slug, version from submissions where id in ('open-old', 'open-new', 'rej') order by id")).toEqual([
      { id: "open-new", status: "queued", slug: "tool", version: "3.0.0" },
      { id: "open-old", status: "withdrawn", slug: "tool", version: "3.0.0" },
      { id: "rej", status: "rejected", slug: "tool", version: "4.0.0" },
    ]);
  });

  it("refuses a second open submission of the same version", () => {
    expect(() =>
      sqlite.prepare("insert into submissions (id, extension_id, author_id, type, github_repo, github_tag, status, version) values ('dup', 'e1', 'a1', 'new_version', 'r', 'main', 'awaiting_review', '3.0.0')").run()
    ).toThrow(/UNIQUE/);
  });

  it("points the latest caches at the highest versions, not the newest", () => {
    expect(one("select (select version from extension_versions where id = latest_stable_version_id) stable, (select version from extension_versions where id = latest_beta_version_id) beta, permissions, min_app_version from extensions where id = 'e1'")).toEqual({
      stable: "1.10.0", beta: "2.0.0-beta.1", permissions: JSON.stringify(["perm:1.10.0"]), min_app_version: "1.2.0",
    });
  });

  it("leaves data that verifies against the files", () => {
    expect(verifyData(sqlite, uploads).problems).toEqual([]);
  });

  it("is noticed when a bundle file changed", () => {
    fs.writeFileSync(path.join(uploads, "bundles/tool/1.9.0/tool-1.9.0.zip"), "tampered");
    expect(verifyData(sqlite, uploads).problems).toEqual([expect.stringContaining("tool 1.9.0: bundle hash")]);
  });
});
