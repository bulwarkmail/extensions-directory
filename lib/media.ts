import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { extensions, screenshots } from "./db/schema";
import { storeBanner, storeIcon, storeScreenshot } from "./storage";
import type { NormalizedManifest } from "./manifest";

const MAX_ICON_BYTES = 256 * 1024; // 256 KB
const MAX_BANNER_BYTES = 512 * 1024; // 512 KB
const MAX_SCREENSHOT_BYTES = 512 * 1024; // 512 KB
const MAX_SCREENSHOT_TOTAL = 2 * 1024 * 1024; // 2 MB combined
const FETCH_TIMEOUT_MS = 15_000;

const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function extOf(p: string): string {
  const dot = p.lastIndexOf(".");
  return dot >= 0 ? p.slice(dot).toLowerCase() : "";
}

interface FetchedImage {
  bytes: Buffer;
  ext: string;
  mime: string;
  sourcePath: string;
}

async function fetchRepoBinary(
  repo: string,
  ref: string,
  filePath: string,
  maxBytes: number,
): Promise<FetchedImage | null> {
  const url =
    `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/` +
    filePath.split("/").map(encodeURIComponent).join("/");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch ${filePath} from ${repo}@${ref}: ${res.status}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(
      `Image ${filePath} is ${(buf.length / 1024).toFixed(0)} KB — exceeds ${(maxBytes / 1024).toFixed(0)} KB limit`,
    );
  }

  // Trust the file extension first (most reliable for SVG vs raster), then
  // fall back to the server-reported Content-Type.
  const ext = extOf(filePath);
  const mime =
    EXT_TO_MIME[ext] ??
    (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    throw new Error(`Image ${filePath} has unsupported type ${mime || "unknown"}`);
  }

  return { bytes: buf, ext, mime, sourcePath: filePath };
}

export interface MediaExtractionReport {
  iconStored: string | null;
  bannerStored: string | null;
  screenshotsStored: string[];
  warnings: string[];
}

/**
 * Pull icon/banner/screenshots declared in the manifest from the source repo,
 * validate each, persist to local storage, and update the DB rows for the
 * given extension. Designed to be called from the approval pipeline AFTER the
 * extension row exists. Failures on individual images are surfaced as
 * warnings rather than aborting the whole approval — a missing screenshot
 * shouldn't block a release.
 */
export async function extractAndStoreMedia(
  repo: string,
  ref: string,
  subpath: string,
  manifest: NormalizedManifest,
  extensionId: string,
): Promise<MediaExtractionReport> {
  const cleanedSub = (subpath || "").replace(/^\/+|\/+$/g, "");
  const prefix = (rel: string) => (cleanedSub ? `${cleanedSub}/${rel}` : rel);

  const warnings: string[] = [];
  let iconStored: string | null = null;
  let bannerStored: string | null = null;
  const screenshotsStored: string[] = [];

  // ── Icon ───────────────────────────────────────────────
  if (manifest.icon) {
    try {
      const fetched = await fetchRepoBinary(
        repo,
        ref,
        prefix(manifest.icon),
        MAX_ICON_BYTES,
      );
      if (fetched) {
        const ext = fetched.ext === ".svg" ? "svg" : "png";
        iconStored = await storeIcon(manifest.slug, fetched.bytes, ext);
      } else {
        warnings.push(`icon: ${manifest.icon} not found in repo`);
      }
    } catch (err) {
      warnings.push(`icon: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Banner ─────────────────────────────────────────────
  if (manifest.banner) {
    try {
      const fetched = await fetchRepoBinary(
        repo,
        ref,
        prefix(manifest.banner),
        MAX_BANNER_BYTES,
      );
      if (fetched) {
        bannerStored = await storeBanner(
          manifest.slug,
          fetched.bytes,
          fetched.ext.replace(/^\./, ""),
        );
      } else {
        warnings.push(`banner: ${manifest.banner} not found in repo`);
      }
    } catch (err) {
      warnings.push(`banner: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Screenshots ────────────────────────────────────────
  let screenshotTotal = 0;
  for (let i = 0; i < manifest.screenshots.length; i++) {
    const path = manifest.screenshots[i];
    try {
      const fetched = await fetchRepoBinary(
        repo,
        ref,
        prefix(path),
        MAX_SCREENSHOT_BYTES,
      );
      if (!fetched) {
        warnings.push(`screenshot ${i + 1}: ${path} not found in repo`);
        continue;
      }
      screenshotTotal += fetched.bytes.length;
      if (screenshotTotal > MAX_SCREENSHOT_TOTAL) {
        warnings.push(
          `screenshot ${i + 1}: dropped — combined gallery exceeds ${(MAX_SCREENSHOT_TOTAL / 1024).toFixed(0)} KB`,
        );
        break;
      }
      const stored = await storeScreenshot(
        manifest.slug,
        fetched.bytes,
        `${i + 1}`,
        fetched.ext.replace(/^\./, ""),
      );
      screenshotsStored.push(stored);
    } catch (err) {
      warnings.push(
        `screenshot ${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Persist to DB ──────────────────────────────────────
  await db
    .update(extensions)
    .set({
      iconPath: iconStored,
      bannerPath: bannerStored,
      updatedAt: new Date(),
    })
    .where(eq(extensions.id, extensionId));

  // Replace existing screenshots for this extension with the freshly stored set.
  await db.delete(screenshots).where(eq(screenshots.extensionId, extensionId));
  if (screenshotsStored.length > 0) {
    await db.insert(screenshots).values(
      screenshotsStored.map((path, idx) => ({
        extensionId,
        path,
        sortOrder: idx,
      })),
    );
  }

  return { iconStored, bannerStored, screenshotsStored, warnings };
}
