// Re-encodes every image an author supplies (icon, banner, screenshots,
// theme previews) before the directory stores or shows it. Nothing an
// author uploaded is ever served as-is: an SVG comes out as a PNG without
// its scripts, a PNG or JPEG comes out without its metadata and anything
// appended to it, and the type is decided by decoding, not by the name.
//
// Kept free of Next and database imports so the media conversion script
// (scripts/reencode-media.ts) can bundle it.
import crypto from "crypto";
import sharp from "sharp";

export type ImageKind = "icon" | "banner" | "screenshot" | "preview";

export class ImageError extends Error {}

/** Compressed bytes an author may send per image. */
export const MAX_INPUT_BYTES: Record<ImageKind, number> = {
  icon: 256 * 1024,
  banner: 512 * 1024,
  screenshot: 512 * 1024,
  preview: 512 * 1024,
};

const MAX_PIXELS = 25_000_000;
const MAX_SVG_SIDE = 4096;
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp", "gif", "svg"]);

export interface EncodedImage {
  data: Buffer;
  ext: "png" | "webp";
  contentType: "image/png" | "image/webp";
  width: number;
  height: number;
  /** First 12 hex of the output's SHA-256, for cache-safe file names. */
  hash: string;
}

function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  return head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--") || /<svg[\s>]/i.test(head);
}

// librsvg resolves hrefs, and has had path traversal bugs doing it. Only
// in-document references and inline raster images are allowed; DOCTYPEs
// go too, since entities are the classic XML expansion attack.
function checkSvg(text: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ImageError("SVG must not contain a DOCTYPE or entities");
  const hrefs = text.matchAll(/(?:xlink:)?href\s*=\s*(["'])([\s\S]*?)\1/gi);
  for (const [, , value] of hrefs) {
    const v = value.trim();
    if (v.startsWith("#")) continue;
    if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(v)) continue;
    throw new ImageError("SVG must not reference external files");
  }
  if (/url\(\s*["']?(?!#|data:image\/)/i.test(text)) throw new ImageError("SVG must not reference external files");
  if (/@import/i.test(text)) throw new ImageError("SVG must not import stylesheets");
}

export async function encodeImage(input: Buffer, kind: ImageKind): Promise<EncodedImage> {
  if (input.length === 0) throw new ImageError("Image is empty");
  if (input.length > MAX_INPUT_BYTES[kind]) {
    throw new ImageError(`Image is ${Math.ceil(input.length / 1024)} KB; at most ${MAX_INPUT_BYTES[kind] / 1024} KB is allowed`);
  }
  if (looksLikeSvg(input)) checkSvg(input.toString("utf8"));

  const open = () => sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false });
  let meta: sharp.Metadata;
  try {
    meta = await open().metadata();
  } catch {
    throw new ImageError("Not a readable image");
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new ImageError(`Unsupported image type ${meta.format ?? "unknown"}; use PNG, JPEG, WebP, GIF or SVG`);
  }
  if (meta.format === "svg" && ((meta.width ?? 0) > MAX_SVG_SIDE || (meta.height ?? 0) > MAX_SVG_SIDE)) {
    throw new ImageError(`SVG is larger than ${MAX_SVG_SIDE} px on a side`);
  }
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_PIXELS) throw new ImageError("Image has too many pixels");

  // rotate() applies the EXIF orientation before the metadata is dropped;
  // sharp writes no metadata unless asked to.
  const pipeline = open().rotate();
  let out: { data: Buffer; info: sharp.OutputInfo };
  let ext: "png" | "webp";
  try {
    if (kind === "icon") {
      ext = "png";
      out = await pipeline
        .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
    } else {
      ext = "webp";
      out = await pipeline
        .resize({ width: kind === "banner" ? 1600 : 1920, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
    }
  } catch (err) {
    throw new ImageError(`Image could not be converted: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    data: out.data,
    ext,
    contentType: ext === "png" ? "image/png" : "image/webp",
    width: out.info.width,
    height: out.info.height,
    hash: crypto.createHash("sha256").update(out.data).digest("hex").slice(0, 12),
  };
}

/** Where a re-encoded image lives under the uploads folder. */
export function mediaPath(slug: string, name: string, image: EncodedImage): string {
  const safeSlug = slug.replace(/[^a-z0-9-]/g, "_");
  return `media/${safeSlug}/${name}-${image.hash}.${image.ext}`;
}
