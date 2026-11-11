// Every SVG goes through the text checks (no DOCTYPE, no entities, no
// external references). libvips would also read gzip-compressed SVG (svgz),
// so encodeImage refuses compressed input before sharp sees it.
//
// The document here is harmless: one entity that holds a colour.
import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { encodeImage, ImageError } from "./images";

const SVG =
  `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY c "#336699">]>` +
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="&c;"/></svg>`;

describe("SVG with a DOCTYPE and an entity", () => {
  it("is refused as text", async () => {
    await expect(encodeImage(Buffer.from(SVG), "icon")).rejects.toThrow(/DOCTYPE/);
  });

  it("is refused when gzip-compressed", async () => {
    await expect(encodeImage(zlib.gzipSync(Buffer.from(SVG)), "icon")).rejects.toBeInstanceOf(ImageError);
  });
});
