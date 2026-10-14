import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), "data", "uploads");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Absolute path for a stored file, or null when it would leave UPLOADS_DIR. */
function resolveUpload(relativePath: string): string | null {
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  const root = path.resolve(UPLOADS_DIR);
  const full = path.resolve(root, normalized);
  return full.startsWith(root + path.sep) ? full : null;
}

// Bundle storage: /data/uploads/bundles/{slug}/{version}/{slug}-{version}.zip
export async function storeBundleFile(
  slug: string,
  version: string,
  data: Buffer
): Promise<{ path: string; sha256: string; size: number }> {
  const safeSlug = sanitizeFilename(slug);
  const safeVersion = sanitizeFilename(version);
  const dir = path.join(UPLOADS_DIR, "bundles", safeSlug, safeVersion);
  await ensureDir(dir);

  const filename = `${safeSlug}-${safeVersion}.zip`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, data);

  const sha256 = crypto.createHash("sha256").update(data).digest("hex");

  return {
    path: `bundles/${safeSlug}/${safeVersion}/${filename}`,
    sha256,
    size: data.length,
  };
}

/** Paths the image encoder writes (lib/images.ts mediaPath). */
export const MEDIA_PATH_RE = /^media\/[a-z0-9_-]+\/[a-z0-9-]+-[0-9a-f]{12}\.(png|webp)$/;

/**
 * Store a re-encoded image at its media/ path. Only output of the encoder
 * goes here; the files route serves nothing else as an image.
 */
export async function storeMedia(relativePath: string, data: Buffer): Promise<void> {
  const full = MEDIA_PATH_RE.test(relativePath) ? resolveUpload(relativePath) : null;
  if (!full) throw new Error(`Not a media path: ${relativePath}`);
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, data);
}

// Read a stored file
export async function getStoredFile(
  relativePath: string
): Promise<Buffer | null> {
  const full = resolveUpload(relativePath);
  if (!full) return null;
  try {
    return await fs.readFile(full);
  } catch {
    return null;
  }
}
