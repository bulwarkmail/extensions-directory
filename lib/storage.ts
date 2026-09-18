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

// Icon storage: /data/uploads/icons/{slug}/icon.{ext}
export async function storeIcon(
  slug: string,
  data: Buffer,
  ext: string
): Promise<string> {
  const safeSlug = sanitizeFilename(slug);
  const safeExt = ext === "svg" ? "svg" : "png";
  const dir = path.join(UPLOADS_DIR, "icons", safeSlug);
  await ensureDir(dir);

  const filePath = path.join(dir, `icon.${safeExt}`);
  await fs.writeFile(filePath, data);
  return `icons/${safeSlug}/icon.${safeExt}`;
}

const ALLOWED_IMG_EXTS = new Set(["png", "jpg", "jpeg", "webp", "svg"]);
function safeImgExt(ext: string | undefined): string {
  const lower = (ext || "png").toLowerCase().replace(/^\./, "");
  return ALLOWED_IMG_EXTS.has(lower) ? lower : "png";
}

// Banner storage
export async function storeBanner(
  slug: string,
  data: Buffer,
  ext: string = "png",
): Promise<string> {
  const safeSlug = sanitizeFilename(slug);
  const safeExt = safeImgExt(ext);
  const dir = path.join(UPLOADS_DIR, "banners", safeSlug);
  await ensureDir(dir);

  const filePath = path.join(dir, `banner.${safeExt}`);
  await fs.writeFile(filePath, data);
  return `banners/${safeSlug}/banner.${safeExt}`;
}

// Screenshot storage
export async function storeScreenshot(
  slug: string,
  data: Buffer,
  screenshotId: string,
  ext: string = "png",
): Promise<string> {
  const safeSlug = sanitizeFilename(slug);
  const safeId = sanitizeFilename(screenshotId);
  const safeExt = safeImgExt(ext);
  const dir = path.join(UPLOADS_DIR, "screenshots", safeSlug);
  await ensureDir(dir);

  const filePath = path.join(dir, `${safeId}.${safeExt}`);
  await fs.writeFile(filePath, data);
  return `screenshots/${safeSlug}/${safeId}.${safeExt}`;
}

// Theme preview storage
export async function storeThemePreview(
  slug: string,
  variant: string,
  data: Buffer
): Promise<string> {
  const safeSlug = sanitizeFilename(slug);
  const safeVariant = sanitizeFilename(variant);
  const dir = path.join(UPLOADS_DIR, "theme-previews", safeSlug);
  await ensureDir(dir);

  const filePath = path.join(dir, `${safeVariant}.png`);
  await fs.writeFile(filePath, data);
  return `theme-previews/${safeSlug}/${safeVariant}.png`;
}

// Read a stored file
export async function getStoredFile(
  relativePath: string
): Promise<Buffer | null> {
  // Prevent path traversal
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }

  const filePath = path.join(UPLOADS_DIR, normalized);

  // Double-check the resolved path is under UPLOADS_DIR
  const resolvedPath = path.resolve(filePath);
  const resolvedUploads = path.resolve(UPLOADS_DIR);
  if (!resolvedPath.startsWith(resolvedUploads)) {
    return null;
  }

  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

// Delete a stored file
export async function deleteStoredFile(relativePath: string): Promise<void> {
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return;

  const filePath = path.join(UPLOADS_DIR, normalized);
  const resolvedPath = path.resolve(filePath);
  const resolvedUploads = path.resolve(UPLOADS_DIR);
  if (!resolvedPath.startsWith(resolvedUploads)) return;

  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore if not found
  }
}

// Get file info
export async function getFileInfo(relativePath: string) {
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return null;

  const filePath = path.join(UPLOADS_DIR, normalized);
  const resolvedPath = path.resolve(filePath);
  const resolvedUploads = path.resolve(UPLOADS_DIR);
  if (!resolvedPath.startsWith(resolvedUploads)) return null;

  try {
    const stat = await fs.stat(filePath);
    return { size: stat.size, modifiedAt: stat.mtime };
  } catch {
    return null;
  }
}
