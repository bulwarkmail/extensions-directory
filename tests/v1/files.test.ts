// GET /api/v1/files/{path}: only re-encoded media and public bundles.
import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { PNG_1PX, seed, writeUpload } from "../fixtures/seed";
import { params, req } from "../helpers/http";
import { GET } from "@/app/api/v1/files/[...path]/route";
import { GET as iconGET } from "@/app/api/v1/extension/[slug]/icon/route";

const get = (p: string) => GET(req(`/api/v1/files/${p}`), params({ path: p.split("/") }));

function allUploads(dir = process.env.UPLOADS_DIR!, prefix = ""): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allUploads(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]
  );
}

beforeAll(async () => {
  await seed();
  writeUpload("media/nord/icon-0123456789ab.png", PNG_1PX);
});

describe("files route", () => {
  it("never answers with an SVG, whatever is stored", async () => {
    const files = allUploads();
    expect(files.some((f) => f.endsWith(".svg"))).toBe(true);
    for (const f of files) {
      const res = await get(f);
      expect(res.headers.get("content-type") ?? "").not.toContain("svg");
    }
  });

  it.each([
    "icons/jitsi-meet/icon.png",
    "banners/jitsi-meet/banner.svg",
    "screenshots/jitsi-meet/1.png",
    "theme-previews/nord/light.png",
  ])("refuses the raw upload %s", async (p) => {
    expect((await get(p)).status).toBe(404);
  });

  it("serves re-encoded media with headers that stop sniffing and scripts", async () => {
    const res = await get("media/nord/icon-0123456789ab.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("serves bundles of approved versions only", async () => {
    expect((await get("bundles/jitsi-meet/1.0.0/jitsi-meet-1.0.0.zip")).status).toBe(200);
    expect((await get("bundles/jitsi-meet/1.12.0/jitsi-meet-1.12.0.zip")).status).toBe(404);
    expect((await get("bundles/evil/0.1.0/evil-0.1.0.zip")).status).toBe(404);
  });

  it("refuses paths outside the uploads folder", async () => {
    expect((await GET(req("/api/v1/files/x"), params({ path: ["media", "..", "..", "test.db"] }))).status).toBe(404);
  });
});

describe("icon route", () => {
  it("does not serve an icon that was never re-encoded", async () => {
    const res = await iconGET(req("/api/v1/extension/nord/icon"), params({ slug: "nord" }));
    expect(res.status).toBe(404);
  });
});
