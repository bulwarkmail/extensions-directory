// Turns a source archive into the files of a bundle. The directory never
// takes a bundle an author built:
//   - package.json with a "build" script: the directory builds it in the
//     sandbox; committed dist/, build/ or prebuilt zips are ignored.
//   - no build script: the plain files at the extension's folder are the
//     bundle (themes, hand-written plugins).
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import JSZip from "jszip";
import { SOURCE_DIRS, shouldSkip, MAX_BUNDLE_FILES } from "@/lib/bundle-rules";
import type { NormalizedManifest } from "@/lib/manifest";
import { BuildError, MAX_SOURCE_BYTES, MAX_SOURCE_FILES, getRunner, pickOutput } from "./sandbox";
import { pack, unpack } from "./tar";

export { BuildError };

const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_ARCHIVE_INFLATED = 300 * 1024 * 1024;

export interface ResolvedFiles {
  files: Map<string, Uint8Array>;
  source: "flat" | "sandbox-build";
  note: string;
  log: string;
  image: string | null;
}

/** Open a source archive with a single top folder; refuses odd or huge archives. */
export async function openArchive(buf: Buffer): Promise<{ zip: JSZip; top: string }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new BuildError("The source archive is not a valid ZIP file");
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ARCHIVE_ENTRIES) throw new BuildError(`The repository has more than ${MAX_ARCHIVE_ENTRIES} files`);
  let inflated = 0;
  for (const n of names) {
    // JSZip keeps the central directory sizes here; nothing is inflated yet.
    inflated += (zip.files[n] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  }
  if (inflated > MAX_ARCHIVE_INFLATED) throw new BuildError("The repository is too large to build");
  const tops = new Set(names.map((n) => n.split("/")[0]).filter(Boolean));
  if (tops.size !== 1) throw new BuildError("Unexpected archive layout");
  return { zip, top: `${[...tops][0]}/` };
}

/** Files under prefix, as a sorted map; skips .git and node_modules. */
export async function collectSource(zip: JSZip, prefix: string): Promise<Map<string, Uint8Array>> {
  const rels = Object.keys(zip.files)
    .filter((p) => !zip.files[p].dir && p.startsWith(prefix))
    .map((p) => p.slice(prefix.length))
    .filter((r) => r && !r.startsWith(".git/") && !r.startsWith("node_modules/") && !r.split("/").includes(".."))
    .sort();
  if (rels.length > MAX_SOURCE_FILES) throw new BuildError(`The extension folder has more than ${MAX_SOURCE_FILES} files`);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const r of rels) {
    const data = await zip.file(prefix + r)!.async("uint8array");
    total += data.length;
    if (total > MAX_SOURCE_BYTES) throw new BuildError(`The extension folder is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB`);
    files.set(r, data);
  }
  return files;
}

function hasBuildScript(source: Map<string, Uint8Array>): boolean {
  const pkg = source.get("package.json");
  if (!pkg) return false;
  try {
    const parsed = JSON.parse(Buffer.from(pkg).toString("utf8"));
    return typeof parsed?.scripts?.build === "string" && parsed.scripts.build.trim() !== "";
  } catch {
    return false;
  }
}

const CACHE_DIR = () => process.env.SANDBOX_BUILD_CACHE || path.join(process.cwd(), "data", "build-cache");

async function cached<T extends { tree: Map<string, Uint8Array>; log: string; image: string }>(key: string, build: () => Promise<T>): Promise<{ tree: Map<string, Uint8Array>; log: string; image: string; hit: boolean }> {
  const file = path.join(CACHE_DIR(), `${key}.tar`);
  try {
    const buf = await fs.readFile(file);
    const meta = JSON.parse((await fs.readFile(`${file}.json`)).toString("utf8")) as { log: string; image: string };
    return { tree: unpack(buf, { maxFiles: 100_000, maxBytes: 500 * 1024 * 1024 }), ...meta, hit: true };
  } catch {
    // not cached
  }
  const r = await build();
  try {
    await fs.mkdir(CACHE_DIR(), { recursive: true });
    await fs.writeFile(file, pack(r.tree));
    await fs.writeFile(`${file}.json`, JSON.stringify({ log: r.log, image: r.image }));
    const names = (await fs.readdir(CACHE_DIR())).filter((n) => n.endsWith(".tar"));
    if (names.length > 50) {
      const stats = await Promise.all(names.map(async (n) => ({ n, t: (await fs.stat(path.join(CACHE_DIR(), n))).mtimeMs })));
      for (const s of stats.sort((a, b) => a.t - b.t).slice(0, names.length - 50)) {
        await fs.rm(path.join(CACHE_DIR(), s.n), { force: true });
        await fs.rm(path.join(CACHE_DIR(), `${s.n}.json`), { force: true });
      }
    }
  } catch {
    // The cache is best-effort.
  }
  return { ...r, hit: false };
}

export async function resolveBundleFiles(source: Map<string, Uint8Array>, manifest: NormalizedManifest): Promise<ResolvedFiles> {
  const manifestBytes = source.get("manifest.json");
  if (!manifestBytes) throw new BuildError("manifest.json is missing");
  const expected = manifest.type === "theme" ? "theme.css" : manifest.entrypoint;

  if (hasBuildScript(source)) {
    const runner = getRunner();
    if (!runner) throw new BuildError('This extension has a "build" script, but builds are switched off on this directory right now.');
    const hash = crypto.createHash("sha256");
    hash.update(`${runner.name}\n${process.env.SANDBOX_BUILD_IMAGE ?? ""}\n`);
    for (const [k, v] of source) hash.update(k).update("\0").update(v).update("\0");
    const built = await cached(hash.digest("hex"), () => runner.build(source));
    const { files, outDir } = pickOutput(built.tree, expected, manifestBytes);
    return {
      files,
      source: "sandbox-build",
      note: `Built by the directory with npm run build (output from ${outDir ? `${outDir}/` : "the extension folder"})${built.hit ? ", from cache" : ""}`,
      log: built.log,
      image: built.image,
    };
  }

  if (!source.has(expected)) {
    const authorBuilt = ["dist/", "build/"].find((d) => source.has(d + expected));
    if (authorBuilt || source.has(`${manifest.slug}.zip`)) {
      throw new BuildError(`${expected} is only in ${authorBuilt ?? `${manifest.slug}.zip`}, which was built outside the directory. Add a "build" script to package.json so the directory can build it from source.`);
    }
    throw new BuildError(`${expected} is missing from the extension folder.`);
  }

  // Marketplace images are the directory's, re-encoded and served apart.
  const media = new Set([manifest.icon, manifest.banner, ...manifest.screenshots].filter(Boolean).map((p) => p!.replace(/^\.?\//, "")));
  const files = new Map<string, Uint8Array>();
  for (const [rel, data] of source) {
    const top = rel.split("/")[0];
    if (SOURCE_DIRS.includes(`${top}/`) || top === "dist" || top === "build" || top === "media" || media.has(rel)) continue;
    if (rel === "package.json" || rel.endsWith(".zip") || shouldSkip(rel)) continue;
    files.set(rel, data);
  }
  if (files.size > MAX_BUNDLE_FILES) throw new BuildError(`The bundle would have more than ${MAX_BUNDLE_FILES} files`);
  return { files, source: "flat", note: "Packed the files in the extension folder as they are", log: "", image: null };
}

/** The bundle zip: sorted entries, fixed dates, so the same files give the same bytes. */
export async function zipBundle(files: Map<string, Uint8Array>): Promise<Buffer> {
  const zip = new JSZip();
  const date = new Date("2000-01-01T00:00:00Z");
  for (const [rel, data] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) zip.file(rel, data, { date, createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}
