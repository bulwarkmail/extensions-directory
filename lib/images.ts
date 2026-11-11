// Re-encodes every image an author supplies (icon, banner, screenshots,
// theme previews) before the directory stores or shows it. Nothing an
// author uploaded is ever served as-is: an SVG comes out as a PNG without
// its scripts, a PNG or JPEG comes out without its metadata and anything
// appended to it, and the type is decided by the bytes, not by the name.
//
// The first bytes decide the format before any decoder sees the file: PNG,
// JPEG, WebP, GIF, or SVG as UTF-8 text. Anything else, compressed SVG
// included, is refused here. An SVG always passes the text checks, and the
// decoder gets exactly the text that was checked.
//
// In the worker, the decoding itself runs in a child process per image that
// has none of the worker's secrets (decodeInChildProcess).
//
// Kept free of Next and database imports so the media conversion script
// (scripts/reencode-media.ts) can bundle it.
import { fork } from "child_process";
import crypto from "crypto";
import sharp, { type Metadata, type OutputInfo } from "sharp";

// Every process that imports this module (the worker, the media conversion
// script) can only load the five accepted formats, from a buffer. The
// signature check below decides first; this keeps the other libvips loaders
// (TIFF, HEIF, ...) closed even if that check changes.
sharp.block({ operation: ["VipsForeignLoad"] });
sharp.unblock({
  operation: [
    "VipsForeignLoadPngBuffer",
    "VipsForeignLoadJpegBuffer",
    "VipsForeignLoadWebpBuffer",
    "VipsForeignLoadNsgifBuffer",
    "VipsForeignLoadSvgBuffer",
  ],
});

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

type Format = "png" | "jpeg" | "webp" | "gif" | "svg";

export interface EncodedImage {
  data: Buffer;
  ext: "png" | "webp";
  contentType: "image/png" | "image/webp";
  width: number;
  height: number;
  /** First 12 hex of the output's SHA-256, for cache-safe file names. */
  hash: string;
}

function startsWith(bytes: Buffer, offset: number, sig: string | number[]): boolean {
  const s = typeof sig === "string" ? Buffer.from(sig, "latin1") : Buffer.from(sig);
  return bytes.length >= offset + s.length && bytes.subarray(offset, offset + s.length).equals(s);
}

function rasterFormat(bytes: Buffer): Exclude<Format, "svg"> | null {
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) return "webp";
  if (startsWith(bytes, 0, "GIF87a") || startsWith(bytes, 0, "GIF89a")) return "gif";
  return null;
}

/** Names a few formats that are refused, for the author's error message. */
function refusedFormat(bytes: Buffer): string | null {
  if (startsWith(bytes, 0, [0x1f, 0x8b])) return "gzip";
  if (startsWith(bytes, 0, "II*\0") || startsWith(bytes, 0, "MM\0*")) return "tiff";
  if (startsWith(bytes, 4, "ftyp")) return /^avi[fs]$/.test(bytes.toString("latin1", 8, 12)) ? "avif" : "heif";
  if (startsWith(bytes, 0, "BM")) return "bmp";
  return null;
}

// libxml2 reads UTF-16, UTF-32 and other encodings when a byte order mark,
// the first bytes or the XML declaration say so, and the text checks would
// not see what it reads. So an SVG is UTF-8 only: valid UTF-8 (a UTF-8 byte
// order mark is dropped), no NUL, no other encoding declared. Returns the
// text to check and decode, without leading whitespace (libxml2 refuses an
// XML declaration after it), or null if the bytes are not SVG text.
function svgText(bytes: Buffer): string | null {
  if (startsWith(bytes, 0, [0xfe, 0xff]) || startsWith(bytes, 0, [0xff, 0xfe]) || startsWith(bytes, 0, [0, 0, 0xfe, 0xff])) {
    throw new ImageError("SVG must be UTF-8 text");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  text = text.replace(/^[\t\n\r ]+/, "");
  if (!text.startsWith("<") || !/<svg\b/i.test(text.slice(0, 1024))) return null;
  if (text.includes("\0")) throw new ImageError("SVG must be UTF-8 text");
  for (const [decl] of text.matchAll(/<\?xml\b[^>]*/gi)) {
    const encoding = /\bencoding\s*=\s*["']?([^"'\s?>]*)/i.exec(decl);
    if (encoding && !/^utf-?8$/i.test(encoding[1])) throw new ImageError("SVG must be UTF-8 text");
  }
  return text;
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

let childScript: string | null = null;

/**
 * Makes encodeImage decode each image in a new child process started from
 * `script` (worker/decode-image.ts, bundled). The child's environment holds
 * only the variables in CHILD_ENV, none of the worker's secrets. The checks
 * before decoding stay in this process, so only accepted bytes reach it.
 */
export function decodeInChildProcess(script: string | null): void {
  childScript = script;
}

const CHILD_ENV = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SystemRoot", "NODE_ENV"];
const CHILD_TIMEOUT_MS = 60_000;

export type ChildReply = { image: EncodedImage } | { error: string; imageError: boolean };

function encodeInChild(script: string, bytes: Buffer, kind: ImageKind): Promise<EncodedImage> {
  const env = Object.fromEntries(CHILD_ENV.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])) as NodeJS.ProcessEnv;
  return new Promise((resolve, reject) => {
    const child = fork(script, [], { env, execArgv: [], serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] });
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fn();
    };
    const failed = (why: string) => settle(() => reject(new ImageError(`Image could not be converted: ${why}`)));
    const timer = setTimeout(() => failed("the decoder took too long"), CHILD_TIMEOUT_MS);
    child.on("message", (reply: ChildReply) =>
      settle(() => {
        try {
          if ("image" in reply) resolve(fromChild(reply.image, kind));
          else reject(reply.imageError ? new ImageError(reply.error) : new Error(reply.error));
        } catch {
          reject(new ImageError("Image could not be converted"));
        }
      })
    );
    child.on("error", (err) => failed(err.message));
    child.on("exit", (code, signal) => failed(`the decoder stopped (${signal ?? `exit code ${code}`})`));
    child.send({ input: bytes, kind });
  });
}

// What the child sends back must be the output format for the kind; the
// hash is computed here.
function fromChild(image: EncodedImage, kind: ImageKind): EncodedImage {
  const data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const ext = kind === "icon" ? "png" : "webp";
  if (rasterFormat(data) !== ext || !Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new ImageError("Image could not be converted");
  }
  return { data, ext, contentType: ext === "png" ? "image/png" : "image/webp", width: image.width, height: image.height, hash: hashOf(data) };
}

function hashOf(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 12);
}

export async function encodeImage(input: Buffer, kind: ImageKind): Promise<EncodedImage> {
  if (input.length === 0) throw new ImageError("Image is empty");
  if (input.length > MAX_INPUT_BYTES[kind]) {
    throw new ImageError(`Image is ${Math.ceil(input.length / 1024)} KB; at most ${MAX_INPUT_BYTES[kind] / 1024} KB is allowed`);
  }
  let format: Format | null = rasterFormat(input);
  let bytes = input;
  if (!format) {
    const text = svgText(input);
    if (text === null) {
      const name = refusedFormat(input);
      throw new ImageError(name ? `Unsupported image type ${name}; use PNG, JPEG, WebP, GIF or SVG` : "Not a readable image");
    }
    checkSvg(text);
    format = "svg";
    bytes = Buffer.from(text, "utf8");
  }
  if (childScript) return encodeInChild(childScript, bytes, kind);

  const open = () => sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false });
  let meta: Metadata;
  try {
    meta = await open().metadata();
  } catch {
    throw new ImageError("Not a readable image");
  }
  if (meta.format !== format) throw new ImageError("Not a readable image");
  if (format === "svg" && ((meta.width ?? 0) > MAX_SVG_SIDE || (meta.height ?? 0) > MAX_SVG_SIDE)) {
    throw new ImageError(`SVG is larger than ${MAX_SVG_SIDE} px on a side`);
  }
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_PIXELS) throw new ImageError("Image has too many pixels");

  // rotate() applies the EXIF orientation before the metadata is dropped;
  // sharp writes no metadata unless asked to.
  const pipeline = open().rotate();
  let out: { data: Buffer; info: OutputInfo };
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
    hash: hashOf(out.data),
  };
}

/** Where a re-encoded image lives under the uploads folder. */
export function mediaPath(slug: string, name: string, image: EncodedImage): string {
  const safeSlug = slug.replace(/[^a-z0-9-]/g, "_");
  return `media/${safeSlug}/${name}-${image.hash}.${image.ext}`;
}
