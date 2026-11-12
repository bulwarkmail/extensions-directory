// Re-encodes every image an author supplies (icon, banner, screenshots,
// theme previews) before the directory stores or shows it. Nothing an
// author uploaded is ever served as-is: an SVG comes out as a PNG, a PNG or
// JPEG comes out without its metadata and anything appended to it, and the
// type is decided by the bytes, not by the name.
//
// The first bytes decide the format before any decoder sees the file: PNG,
// JPEG, WebP, GIF, or SVG as UTF-8 text. Anything else, compressed SVG
// included, is refused here. An SVG is parsed and checked as a tree
// (lib/svg.ts), and the decoder gets that tree written out again, never the
// author's text.
//
// In the worker, the decoding itself runs in a child process per image that
// has none of the worker's secrets (decodeInChildProcess).
//
// Kept free of Next and database imports so the media conversion script
// (scripts/reencode-media.ts) can bundle it.
import { fork, spawn, type ChildProcess, type StdioOptions } from "child_process";
import crypto from "crypto";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { checkedSvg } from "./svg";

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
/** Canvas of an SVG that runs filters: each filter step draws on a canvas of its own. */
export const MAX_FILTERED_SVG_PIXELS = 2048 * 2048;

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

// An SVG is UTF-8 only: valid UTF-8 (a UTF-8 byte order mark is dropped), no
// NUL, no other encoding declared, so the parser reads the text as libxml2
// would. Returns the text to parse, without leading whitespace, or null if
// the bytes are not SVG text.
function svgText(bytes: Buffer): string | null {
  if (startsWith(bytes, 0, [0xfe, 0xff]) || startsWith(bytes, 0, [0xff, 0xfe]) || startsWith(bytes, 0, [0, 0, 0xfe, 0xff])) {
    throw new ImageError(NOT_UTF8);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  text = text.replace(/^[\t\n\r ]+/, "");
  // Whether it is an SVG is for the parser to say: the root may come after
  // comments of any length.
  if (!text.startsWith("<")) return null;
  if (text.includes("\0")) throw new ImageError(NOT_UTF8);
  for (const [decl] of text.matchAll(/<\?xml\b[^>]*/gi)) {
    const encoding = /\bencoding\s*=\s*["']?([^"'\s?>]*)/i.exec(decl);
    if (encoding && !/^utf-?8$/i.test(encoding[1])) throw new ImageError(NOT_UTF8);
  }
  return text;
}

// What the author reads on the submission (after "icon: ", "banner: ", ...).
const NOT_UTF8 = "SVG must be UTF-8 text: save the file with UTF-8 encoding";
const NOT_READABLE = "Not a readable image: the file is damaged or in another format; use PNG, JPEG, WebP, GIF or SVG";

/**
 * Address space of the decoder child on Linux, where the worker runs. Node
 * and sharp reserve about 1.2 GB of it before decoding anything (measured
 * with the thread pools below; honest images peaked at 1.24 GB), so this
 * leaves the decoding about half a gigabyte. A child that reaches it fails
 * its allocations and stops, and the image is refused. Elsewhere
 * (development on Windows or macOS) only the limits of the checked SVG apply.
 */
export const CHILD_ADDRESS_SPACE_MB = 1792;

let childScript: string | null = null;
let childAddressSpaceMb = CHILD_ADDRESS_SPACE_MB;

/**
 * Makes encodeImage decode each image in a new child process started from
 * `script` (worker/decode-image.ts, bundled). The child's environment holds
 * only the variables in CHILD_ENV, none of the worker's secrets. The checks
 * before decoding stay in this process, so only accepted bytes reach it.
 */
export function decodeInChildProcess(script: string | null, options: { addressSpaceMb?: number } = {}): void {
  childScript = script;
  childAddressSpaceMb = options.addressSpaceMb ?? CHILD_ADDRESS_SPACE_MB;
}

const CHILD_ENV = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SystemRoot", "NODE_ENV"];
// Few threads, so the address space the child reserves doesn't grow with the
// host's CPU count: glibc keeps one malloc arena per thread, and every
// thread reserves a stack. worker/decode-image.ts sets sharp's to one.
const CHILD_TUNING = { MALLOC_ARENA_MAX: "2", UV_THREADPOOL_SIZE: "2" };
const CHILD_NODE_OPTIONS = ["--v8-pool-size=2"];
const CHILD_TIMEOUT_MS = 60_000;

export type ChildReply = { image: EncodedImage } | { error: string; imageError: boolean };

function startChild(script: string): ChildProcess {
  const env: Record<string, string | undefined> = {
    ...Object.fromEntries(CHILD_ENV.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])),
    ...CHILD_TUNING,
  };
  const options = { env: env as NodeJS.ProcessEnv, serialization: "advanced" as const, stdio: ["ignore", "inherit", "inherit", "ipc"] as StdioOptions };
  if (process.platform !== "linux") return fork(script, [], { ...options, execArgv: CHILD_NODE_OPTIONS });
  // The shell sets the limit and then becomes node (same process); the IPC
  // channel stays open across exec.
  return spawn(
    "/bin/sh",
    ["-c", 'ulimit -v "$1" || exit 97; shift; exec "$@"', "decode-image", String(childAddressSpaceMb * 1024), process.execPath, ...CHILD_NODE_OPTIONS, script],
    options,
  );
}

function encodeInChild(script: string, bytes: Buffer, kind: ImageKind): Promise<EncodedImage> {
  return new Promise((resolve, reject) => {
    const child = startChild(script);
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
    throw new ImageError(`Image is ${Math.ceil(input.length / 1024)} KB; at most ${MAX_INPUT_BYTES[kind] / 1024} KB is allowed: compress it or make it smaller`);
  }
  let format: Format | null = rasterFormat(input);
  let bytes = input;
  let filtered = false;
  if (!format) {
    const text = svgText(input);
    if (text === null) {
      const name = refusedFormat(input);
      if (!name) throw new ImageError(NOT_READABLE);
      throw new ImageError(`Unsupported image type ${name}; use PNG, JPEG, WebP, GIF or SVG${name === "gzip" ? " (save a compressed .svgz as plain .svg)" : ""}`);
    }
    const checked = checkedSvg(text);
    if (!checked.ok) throw new ImageError(checked.reason);
    format = "svg";
    filtered = checked.filtered;
    bytes = Buffer.from(checked.svg, "utf8");
  }
  if (childScript) return encodeInChild(childScript, bytes, kind);

  const open = () => sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false });
  let meta: Metadata;
  try {
    meta = await open().metadata();
  } catch {
    throw new ImageError(NOT_READABLE);
  }
  if (meta.format !== format) throw new ImageError(NOT_READABLE);
  if (format === "svg" && ((meta.width ?? 0) > MAX_SVG_SIDE || (meta.height ?? 0) > MAX_SVG_SIDE)) {
    throw new ImageError(`SVG is larger than ${MAX_SVG_SIDE} px on a side: set a smaller width and height`);
  }
  // The size librsvg reports here is the canvas it will draw on, before any drawing.
  if (filtered && (meta.width ?? 0) * (meta.height ?? 0) > MAX_FILTERED_SVG_PIXELS) {
    throw new ImageError("An SVG with filters may cover at most 2048 x 2048 px: set a smaller width and height, or leave out the filter");
  }
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_PIXELS) throw new ImageError("Image has more than 25 megapixels: send a smaller image");

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
