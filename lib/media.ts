import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { extensions, screenshots } from "./db/schema";
import { storeMedia } from "./storage";
import { encodeImage, mediaPath, MAX_INPUT_BYTES, type ImageKind } from "./images";
import type { NormalizedManifest } from "./manifest";

const MAX_SCREENSHOT_TOTAL = 2 * 1024 * 1024; // 2 MB combined, as uploaded
const FETCH_TIMEOUT_MS = 15_000;

async function fetchRepoBinary(
  repo: string,
  ref: string,
  filePath: string,
  maxBytes: number,
): Promise<Buffer | null> {
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
  return buf;
}

export interface MediaExtractionReport {
  iconStored: string | null;
  bannerStored: string | null;
  screenshotsStored: string[];
  warnings: string[];
}

/**
 * Pull icon/banner/screenshots declared in the manifest from the source repo,
 * re-encode each (lib/images.ts), persist to local storage, and update the DB
 * rows for the given extension. Designed to be called from the approval
 * pipeline AFTER the extension row exists. Failures on individual images are
 * surfaced as warnings rather than aborting the whole approval — a missing
 * screenshot shouldn't block a release.
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
  const screenshotsStored: string[] = [];

  async function ingest(source: string, kind: ImageKind, name: string, label: string): Promise<{ path: string; bytes: number } | null> {
    try {
      const fetched = await fetchRepoBinary(repo, ref, prefix(source), MAX_INPUT_BYTES[kind]);
      if (!fetched) {
        warnings.push(`${label}: ${source} not found in repo`);
        return null;
      }
      const image = await encodeImage(fetched, kind);
      const path = mediaPath(manifest.slug, name, image);
      await storeMedia(path, image.data);
      return { path, bytes: fetched.length };
    } catch (err) {
      warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  const iconStored = manifest.icon ? (await ingest(manifest.icon, "icon", "icon", "icon"))?.path ?? null : null;
  const bannerStored = manifest.banner ? (await ingest(manifest.banner, "banner", "banner", "banner"))?.path ?? null : null;

  let screenshotTotal = 0;
  for (let i = 0; i < manifest.screenshots.length; i++) {
    const stored = await ingest(manifest.screenshots[i], "screenshot", `screenshot-${i + 1}`, `screenshot ${i + 1}`);
    if (!stored) continue;
    screenshotTotal += stored.bytes;
    if (screenshotTotal > MAX_SCREENSHOT_TOTAL) {
      warnings.push(
        `screenshot ${i + 1}: dropped — combined gallery exceeds ${(MAX_SCREENSHOT_TOTAL / 1024).toFixed(0)} KB`,
      );
      break;
    }
    screenshotsStored.push(stored.path);
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
