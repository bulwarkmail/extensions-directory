// lib/images.ts hands the images an author submits to sharp, in the worker. Two things hold:
//  1. the libraries inside sharp that parse those bytes are the patched ones
//     (GHSA-wq5f-xc86-pv6w librsvg, GHSA-rgj7-g3m4-5g8c libheif, GHSA-f88m-g3jw-g9cj libvips);
//  2. a format the directory does not accept is turned away by its signature, before sharp
//     (and so libheif, libtiff, ...) reads a byte of it.
import zlib from "zlib";
import { describe, expect, it, vi } from "vitest";

const opened = vi.hoisted(() => [] as Buffer[]);
vi.mock("sharp", async (importOriginal) => {
  const real = (await importOriginal<{ default: typeof import("sharp") }>()).default;
  const counting = ((input?: unknown, options?: unknown) => {
    if (Buffer.isBuffer(input)) opened.push(input);
    return (real as unknown as (i?: unknown, o?: unknown) => unknown)(input, options);
  }) as unknown as typeof real;
  Object.assign(counting, real);
  return { default: counting };
});

import sharp from "sharp";
import { encodeImage, ImageError } from "./images";

function atLeast(have: string | undefined, want: string): boolean {
  if (!have) return false;
  const a = have.split(".").map(Number);
  const b = want.split(".").map(Number);
  for (let i = 0; i < b.length; i++) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  }
  return true;
}

describe("the decoders that read author images", () => {
  it("are the patched librsvg, libheif and libvips", () => {
    const v = sharp.versions as Record<string, string | undefined>;
    expect({ rsvg: atLeast(v.rsvg, "2.63.2"), heif: atLeast(v.heif, "1.23.2"), vips: atLeast(v.vips, "8.18.3") }).toEqual({
      rsvg: true,
      heif: true,
      vips: true,
    });
  });

  for (const format of ["avif", "tiff"] as const) {
    it(`never see a ${format.toUpperCase()}: it is refused by its signature`, async () => {
      const pixels = sharp({ create: { width: 8, height: 8, channels: 3, background: "#db2d54" } });
      const bytes = format === "avif" ? await pixels.avif().toBuffer() : await pixels.tiff().toBuffer();
      opened.length = 0;
      await expect(encodeImage(bytes, "icon")).rejects.toBeInstanceOf(ImageError);
      expect(opened.some((b) => b.equals(bytes))).toBe(false);
    });
  }

  it("still take a PNG", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#db2d54" } }).png().toBuffer();
    const out = await encodeImage(png, "icon");
    expect(out.contentType).toBe("image/png");
  });

  it("are closed for formats outside the list, also for a direct sharp call", async () => {
    const pixels = sharp({ create: { width: 8, height: 8, channels: 3, background: "#db2d54" } });
    for (const bytes of [await pixels.clone().tiff().toBuffer(), await pixels.clone().avif().toBuffer()]) {
      await expect(sharp(bytes).metadata()).rejects.toThrow(/unsupported image format/);
    }
    expect((await sharp(await pixels.clone().png().toBuffer()).metadata()).format).toBe("png");
  });
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="#336699"/></svg>';
const solid = (background: string) => sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer();

describe("the signature check", () => {
  it("refuses an empty file before any decoder", async () => {
    opened.length = 0;
    await expect(encodeImage(Buffer.alloc(0), "icon")).rejects.toBeInstanceOf(ImageError);
    expect(opened).toEqual([]);
  });

  it("refuses gzip-compressed input before any decoder, whatever it holds", async () => {
    for (const content of [Buffer.from("just some text"), await solid("#db2d54"), Buffer.from(SVG)]) {
      opened.length = 0;
      await expect(encodeImage(zlib.gzipSync(content), "icon")).rejects.toThrow(/Unsupported image type gzip/);
      expect(opened).toEqual([]);
    }
  });

  it("refuses a BMP before any decoder", async () => {
    opened.length = 0;
    await expect(encodeImage(Buffer.concat([Buffer.from("BM"), Buffer.alloc(60)]), "icon")).rejects.toThrow(/Unsupported image type bmp/);
    expect(opened).toEqual([]);
  });

  it.each([
    ["garbage after the signature", async () => Buffer.concat([(await solid("#db2d54")).subarray(0, 8), Buffer.alloc(200, 0x41)])],
    ["a file cut short", async () => (await solid("#db2d54")).subarray(0, 40)],
  ])("leaves a PNG with %s to the decoder, which refuses it", async (_name, make) => {
    await expect(encodeImage(await make(), "icon")).rejects.toBeInstanceOf(ImageError);
  });

  it.each([
    ["UTF-16 with a byte order mark", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SVG, "utf16le")])],
    ["UTF-16 big-endian with a byte order mark", Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(SVG, "utf16le").swap16()])],
    ["UTF-16 without a byte order mark", Buffer.from(`<?xml version="1.0"?>${SVG}`, "utf16le")],
    ["UTF-8 that declares ISO-8859-1", Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?>${SVG}`)],
    ["UTF-8 that declares UTF-16", Buffer.from(`<?xml version='1.0' encoding='UTF-16'?>${SVG}`)],
    ["UTF-8 with a NUL", Buffer.from(`${SVG.slice(0, 40)}\0${SVG.slice(40)}`)],
  ])("refuses an SVG in %s before any decoder", async (_name, bytes) => {
    opened.length = 0;
    await expect(encodeImage(bytes, "icon")).rejects.toBeInstanceOf(ImageError);
    expect(opened).toEqual([]);
  });

  it.each([
    ["leading whitespace and an XML declaration", `\n  \t<?xml version="1.0" encoding="UTF-8"?>\n${SVG}`],
    ["a UTF-8 byte order mark", `﻿${SVG}`],
  ])("takes an SVG with %s", async (_name, text) => {
    const out = await encodeImage(Buffer.from(text, "utf8"), "icon");
    expect([out.contentType, out.width, out.height]).toEqual(["image/png", 512, 512]);
  });

  it.each(["gif", "webp"] as const)("takes the first frame of an animated %s", async (format) => {
    const animated = await sharp([await solid("#db2d54"), await solid("#336699")], { join: { animated: true } })[format]().toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
    const out = await encodeImage(animated, "screenshot");
    const meta = await sharp(out.data, { animated: true }).metadata();
    expect([meta.format, meta.pages ?? 1, out.width, out.height]).toEqual(["webp", 1, 8, 8]);
  });
});
