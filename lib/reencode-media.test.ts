import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { seed, writeUpload } from "@/tests/fixtures/seed";
import { reencodeStoredMedia } from "./reencode-media";

const uploads = () => process.env.UPLOADS_DIR!;
const open = () => new Database(process.env.DATABASE_PATH!);

beforeAll(async () => {
  await seed();
  // A broken screenshot that can't be converted.
  writeUpload("screenshots/nord/broken.png", Buffer.from("not an image"));
  const db = open();
  db.prepare("insert into screenshots (id, extension_id, path, sort_order) values ('shot-broken', 'ext-nord', 'screenshots/nord/broken.png', 0)").run();
  db.close();
});

describe("reencodeStoredMedia", () => {
  it("reports without writing in a dry run", async () => {
    const db = open();
    const report = await reencodeStoredMedia(db, uploads(), { dryRun: true });
    expect(report.converted.length).toBeGreaterThan(0);
    expect(db.prepare("select icon_path from extensions where id = 'ext-jitsi'").get()).toEqual({ icon_path: "icons/jitsi-meet/icon.png" });
    expect(fs.existsSync(path.join(uploads(), "media"))).toBe(false);
    db.close();
  });

  it("converts every stored image and points the rows at the result", async () => {
    const db = open();
    const report = await reencodeStoredMedia(db, uploads());
    const paths = [
      ...db.prepare("select icon_path as p from extensions where icon_path is not null").all(),
      ...db.prepare("select banner_path as p from extensions where banner_path is not null").all(),
      ...db.prepare("select path as p from screenshots").all(),
      ...db.prepare("select preview_path as p from theme_previews").all(),
    ].map((r) => (r as { p: string }).p);
    expect(paths.length).toBe(3);
    for (const p of paths) {
      expect(p).toMatch(/^media\/[a-z0-9-]+\/[a-z0-9-]+-[0-9a-f]{12}\.(png|webp)$/);
      const meta = await sharp(fs.readFileSync(path.join(uploads(), p))).metadata();
      expect(["png", "webp"]).toContain(meta.format);
    }
    // The SVGs with a script (the nord icon, the jitsi banner, the second
    // screenshot) are refused like the broken screenshot: icon and banner
    // cleared, screenshots deleted, the remaining screenshot kept.
    expect(db.prepare("select icon_path as p from extensions where id = 'ext-nord'").get()).toEqual({ p: null });
    expect(report.dropped).toHaveLength(4);
    expect(report.dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "extensions", id: "ext-nord", reason: "SVG must not contain scripts" }),
        expect.objectContaining({ table: "extensions", id: "ext-jitsi", reason: "SVG must not contain scripts" }),
        expect.objectContaining({ id: "shot-2", reason: "SVG must not contain scripts" }),
        expect.objectContaining({ id: "shot-broken", reason: "Not a readable image" }),
      ])
    );
    expect(db.prepare("select id from screenshots order by sort_order").all()).toEqual([{ id: "shot-1" }]);
    // Old files stay on disk.
    expect(fs.existsSync(path.join(uploads(), "icons/nord/icon.svg"))).toBe(true);
    db.close();
  });

  it("does nothing the second time", async () => {
    const db = open();
    const report = await reencodeStoredMedia(db, uploads());
    expect(report).toEqual({ converted: [], dropped: [] });
    db.close();
  });
});
