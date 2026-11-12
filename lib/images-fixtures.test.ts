// The repo's own images (the site icon, the branding and the template icons in public/)
// go through encodeImage and come out byte for byte as they did when sharp drew the
// author's file directly: checking an SVG and drawing the checked tree changes nothing
// for an honest drawing.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { encodeImage, type ImageKind } from "./images";

const FILES = [
  "app/icon.svg",
  ...fs.readdirSync("public").filter((f) => f.endsWith(".svg")).map((f) => `public/${f}`),
  ...fs.readdirSync("public/branding").filter((f) => /\.(svg|png)$/.test(f)).map((f) => `public/branding/${f}`),
];

// The conversion encodeImage does, on the author's bytes as they are.
function drawDirectly(input: Buffer, kind: ImageKind): Promise<Buffer> {
  const pipeline = sharp(input, { limitInputPixels: 25_000_000, failOn: "error", animated: false }).rotate();
  if (kind === "icon") {
    return pipeline.resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
  }
  return pipeline.resize({ width: kind === "banner" ? 1600 : 1920, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
}

describe("the repo's own images", () => {
  it("are all there", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(11);
  });

  it.each(FILES.flatMap((f) => (["icon", "banner"] as const).map((kind) => [f, kind] as const)))("%s as %s draws as before", async (file, kind) => {
    const input = fs.readFileSync(path.resolve(file));
    const out = await encodeImage(input, kind);
    expect(out.data.equals(await drawDirectly(input, kind))).toBe(true);
  });
});
