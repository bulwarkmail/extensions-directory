import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { encodeImage, ImageError, mediaPath } from "./images";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function solid(width: number, height: number, format: "png" | "jpeg" | "tiff" = "png") {
  return sharp({ create: { width, height, channels: 3, background: "#336699" } })[format]().toBuffer();
}

describe("encodeImage", () => {
  it("turns an SVG with a script into a PNG without it", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert("pwned")</script><rect width="64" height="64" fill="#336"/></svg>'
    );
    const out = await encodeImage(svg, "icon");
    expect(out.data.subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(out.contentType).toBe("image/png");
    expect([out.width, out.height]).toEqual([512, 512]);
    expect(out.data.toString("latin1")).not.toContain("pwned");
  });

  it("drops metadata and anything appended to the file", async () => {
    const withExif = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#fff" } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "SECRET-MARKER" } } })
      .toBuffer();
    expect(withExif.toString("latin1")).toContain("SECRET-MARKER");
    const polyglot = Buffer.concat([withExif, Buffer.from("<script>APPENDED-MARKER</script>")]);
    const out = await encodeImage(polyglot, "screenshot");
    const text = out.data.toString("latin1");
    expect(text).not.toContain("SECRET-MARKER");
    expect(text).not.toContain("APPENDED-MARKER");
    expect(out.contentType).toBe("image/webp");
  });

  it("decides the type from the bytes", async () => {
    const out = await encodeImage(await solid(40, 20, "jpeg"), "banner");
    expect(out.ext).toBe("webp");
    expect([out.width, out.height]).toEqual([40, 20]);
  });

  it("shrinks large screenshots and keeps small ones", async () => {
    expect((await encodeImage(await solid(4000, 1000), "screenshot")).width).toBe(1920);
    expect((await encodeImage(await solid(800, 600), "screenshot")).width).toBe(800);
  });

  it.each([
    ["text", Buffer.from("just some text, not an image")],
    ["empty", Buffer.alloc(0)],
    ["external href", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><image xlink:href="file:///etc/passwd" width="10" height="10"/></svg>')],
    ["remote href", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://t.example/p.png" width="10" height="10"/></svg>')],
    ["css url", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect style="fill:url(https://t.example/x)" width="10" height="10"/></svg>')],
    ["doctype", Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&a;</text></svg>')],
    ["huge svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><rect width="10" height="10"/></svg>')],
  ])("refuses %s", async (_name, input) => {
    await expect(encodeImage(input, "icon")).rejects.toBeInstanceOf(ImageError);
  });

  it("refuses formats outside the list", async () => {
    await expect(encodeImage(await solid(10, 10, "tiff"), "screenshot")).rejects.toThrow(/Unsupported image type tiff/);
  });

  it("refuses images with too many pixels before decoding them", async () => {
    const big = await solid(6000, 5000);
    expect(big.length).toBeLessThan(512 * 1024);
    await expect(encodeImage(big, "screenshot")).rejects.toBeInstanceOf(ImageError);
  });

  it("refuses files over the size limit", async () => {
    await expect(encodeImage(Buffer.alloc(300 * 1024, 1), "icon")).rejects.toThrow(/at most 256 KB/);
  });
});

describe("mediaPath", () => {
  it("names files by slug, role and content hash", async () => {
    const img = await encodeImage(await solid(10, 10), "icon");
    expect(mediaPath("jitsi-meet", "icon", img)).toMatch(/^media\/jitsi-meet\/icon-[0-9a-f]{12}\.png$/);
  });
});
