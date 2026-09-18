import JSZip from "jszip";
import {
  downloadRefArchive,
  fetchRepoFile,
} from "./github";
import { storeBundleFile } from "./storage";
import { buildBundleInSandbox } from "./sandbox-build";
import {
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_FILES,
  SOURCE_DIRS,
  shouldSkip,
} from "./bundle-rules";

export interface NormalizedManifest {
  raw: Record<string, unknown>;
  slug: string;
  displayName: string;
  version: string;
  description: string;
  type: "plugin" | "theme";
  pluginType: "hook" | "ui-extension" | "sidebar-app" | null;
  permissions: string[];
  entrypoint: string;
  minAppVersion: string | null;
  author: string;
  /** Repo-relative path (sibling of manifest.json) to a square brand icon. */
  icon: string | null;
  /** Repo-relative path to the wide promo image shown on the detail page. */
  banner: string | null;
  /** Repo-relative paths to screenshot images, in display order. */
  screenshots: string[];
}

const ALLOWED_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const MAX_SCREENSHOTS = 6;

function sanitizeRepoPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^\/+/, "");
  if (!trimmed) return null;
  // Reject path traversal and absolute references.
  if (trimmed.includes("..") || /^[a-z]+:\/\//i.test(trimmed)) return null;
  // Restrict to allowed image extensions.
  const dot = trimmed.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = trimmed.slice(dot).toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.has(ext)) return null;
  return trimmed;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ALLOWED_PLUGIN_TYPES = ["hook", "ui-extension", "sidebar-app"] as const;

export function validateManifest(raw: unknown):
  | { ok: true; manifest: NormalizedManifest }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "manifest.json is not a JSON object" };
  }
  const m = raw as Record<string, unknown>;

  const id = typeof m.id === "string" ? m.id.trim() : "";
  const name = typeof m.name === "string" ? m.name.trim() : "";
  const version = typeof m.version === "string" ? m.version.trim() : "";
  const description =
    typeof m.description === "string" ? m.description.trim() : "";
  const type = typeof m.type === "string" ? m.type.trim() : "";
  const author = typeof m.author === "string" ? m.author.trim() : "";
  const entrypoint =
    typeof m.entrypoint === "string" ? m.entrypoint.trim() : "";
  const minAppVersion =
    typeof m.minAppVersion === "string" ? m.minAppVersion.trim() : null;
  const permissions = Array.isArray(m.permissions)
    ? m.permissions.filter((p): p is string => typeof p === "string")
    : [];

  if (!name) return { ok: false, error: "Manifest is missing 'name'" };
  if (!version) return { ok: false, error: "Manifest is missing 'version'" };
  if (!SEMVER_RE.test(version)) {
    return {
      ok: false,
      error: `Invalid version "${version}" — use semver (e.g. 1.0.0)`,
    };
  }
  if (!description) {
    return { ok: false, error: "Manifest is missing 'description'" };
  }

  const slug = (id || name.toLowerCase().replace(/[^a-z0-9-]+/g, "-")).replace(
    /^-+|-+$/g,
    ""
  );
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      error: `Invalid slug "${slug}". Use lowercase letters, numbers, and dashes.`,
    };
  }

  let normalizedType: "plugin" | "theme";
  let pluginType: "hook" | "ui-extension" | "sidebar-app" | null;
  if (type === "theme") {
    normalizedType = "theme";
    pluginType = null;
  } else if ((ALLOWED_PLUGIN_TYPES as readonly string[]).includes(type)) {
    normalizedType = "plugin";
    pluginType = type as "hook" | "ui-extension" | "sidebar-app";
  } else if (type === "plugin") {
    // Tolerate the docs format: type=plugin + pluginType=...
    const pt =
      typeof m.pluginType === "string" ? m.pluginType.trim() : "";
    if (!(ALLOWED_PLUGIN_TYPES as readonly string[]).includes(pt)) {
      return {
        ok: false,
        error: `Invalid pluginType "${pt}". Use one of: ${ALLOWED_PLUGIN_TYPES.join(", ")}.`,
      };
    }
    normalizedType = "plugin";
    pluginType = pt as "hook" | "ui-extension" | "sidebar-app";
  } else {
    return {
      ok: false,
      error: `Invalid type "${type}". Use one of: theme, hook, ui-extension, sidebar-app.`,
    };
  }

  if (normalizedType === "plugin" && !entrypoint) {
    return { ok: false, error: "Plugin manifest is missing 'entrypoint'" };
  }

  // Marketplace media — paths in the source repo, NOT runtime-bundled.
  // Themes have historically used `preview`; we accept it as an alias for
  // `banner` so legacy theme manifests keep working.
  const icon = sanitizeRepoPath(m.icon);
  const banner = sanitizeRepoPath(m.banner) ?? sanitizeRepoPath(m.preview);
  const rawScreenshots = Array.isArray(m.screenshots) ? m.screenshots : [];
  const screenshots: string[] = [];
  for (const entry of rawScreenshots) {
    if (screenshots.length >= MAX_SCREENSHOTS) break;
    const safe = sanitizeRepoPath(entry);
    if (safe) screenshots.push(safe);
  }

  return {
    ok: true,
    manifest: {
      raw: m,
      slug,
      displayName: name,
      version,
      description,
      type: normalizedType,
      pluginType,
      permissions,
      entrypoint:
        entrypoint || (normalizedType === "theme" ? "theme.css" : "index.js"),
      minAppVersion,
      author,
      icon,
      banner,
      screenshots,
    },
  };
}

/**
 * Fetch manifest.json from a repo at a specific ref + subpath.
 * Returns null if the file is missing.
 */
export async function fetchManifest(
  repo: string,
  ref: string,
  subpath: string
): Promise<Record<string, unknown> | null> {
  const cleaned = subpath.replace(/^\/+|\/+$/g, "");
  const path = cleaned ? `${cleaned}/manifest.json` : "manifest.json";
  const text = await fetchRepoFile(repo, ref, path);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`manifest.json at ${path} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`manifest.json at ${path} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export interface ResolvedBundle {
  /** Flat map: bundle-relative path → file bytes. manifest.json is always at root. */
  files: Map<string, Uint8Array>;
  /** Where the runtime files came from. */
  source: "prebuilt-zip" | "flat" | "dist" | "build" | "sandbox-build";
  /** A short human-readable summary of what was found. */
  note: string;
}

/**
 * Take a downloaded GitHub zipball and extract a publishable, flat per-extension
 * bundle from it. Tries (in order):
 *
 *   1. <prefix>/<slug>.zip       — prebuilt zip artifact, used as-is
 *   2. <prefix>/<entrypoint>     — sources at the plugin's root
 *   3. <prefix>/dist/<entrypoint> — common esbuild / tsc output
 *   4. <prefix>/build/<entrypoint>
 *   5. a sandboxed server-side build, when package.json declares a "build"
 *      script (npm install + npm run build in a locked-down container)
 *
 * In every case, the returned bundle has manifest.json + entrypoint + assets
 * at the root.
 */
export async function resolveBundle(
  zip: JSZip,
  prefix: string,
  manifest: NormalizedManifest
): Promise<ResolvedBundle> {
  const entrypoint = manifest.entrypoint;

  // 1. Prebuilt <slug>.zip alongside the manifest
  const prebuiltZipFile = zip.file(`${prefix}${manifest.slug}.zip`);
  if (prebuiltZipFile) {
    const inner = await prebuiltZipFile.async("uint8array");
    let innerZip: JSZip;
    try {
      innerZip = await JSZip.loadAsync(inner);
    } catch {
      throw new Error(
        `${manifest.slug}.zip exists but is not a valid ZIP archive`
      );
    }
    const files = new Map<string, Uint8Array>();
    for (const [p, f] of Object.entries(innerZip.files)) {
      if (f.dir) continue;
      if (shouldSkip(p)) continue;
      files.set(p, await f.async("uint8array"));
    }
    if (!files.has("manifest.json")) {
      throw new Error(
        `${manifest.slug}.zip is missing manifest.json at its root`
      );
    }
    if (manifest.type === "plugin" && !files.has(entrypoint)) {
      throw new Error(
        `${manifest.slug}.zip is missing the entrypoint "${entrypoint}"`
      );
    }
    if (manifest.type === "theme" && !files.has("theme.css")) {
      throw new Error(`${manifest.slug}.zip is missing theme.css`);
    }
    return {
      files,
      source: "prebuilt-zip",
      note: `Used prebuilt ${manifest.slug}.zip from the repo`,
    };
  }

  // 2 / 3 / 4 — scan a directory under prefix
  async function tryDir(dir: string): Promise<ResolvedBundle | null> {
    const dirKey = dir.replace(/\/+$/, "");
    const expectedRuntime = manifest.type === "theme" ? "theme.css" : entrypoint;
    const fullExpected = dirKey
      ? `${prefix}${dirKey}/${expectedRuntime}`
      : `${prefix}${expectedRuntime}`;
    if (!zip.file(fullExpected)) return null;

    const files = new Map<string, Uint8Array>();
    // Always pull manifest.json from <prefix>/manifest.json (the source of truth)
    const manifestFile = zip.file(`${prefix}manifest.json`);
    if (!manifestFile) return null; // shouldn't happen, caller validated
    files.set("manifest.json", await manifestFile.async("uint8array"));

    const runtimePrefix = dirKey ? `${prefix}${dirKey}/` : prefix;
    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      if (!path.startsWith(runtimePrefix)) continue;
      const rel = path.substring(runtimePrefix.length);
      if (!rel || rel === "manifest.json") continue;
      // When the runtime root IS the plugin root, we need to skip source dirs
      // so they don't ship to clients.
      if (!dirKey) {
        const top = rel.split("/")[0] + "/";
        if (SOURCE_DIRS.includes(top)) continue;
      }
      if (shouldSkip(rel)) continue;
      // Drop nested dist/build dirs from the flat case to avoid duplication
      if (!dirKey && (rel.startsWith("dist/") || rel.startsWith("build/"))) continue;
      files.set(rel, await file.async("uint8array"));
    }

    return {
      files,
      source: dir === "" ? "flat" : (dir === "dist/" ? "dist" : "build"),
      note: dir
        ? `Used built artifacts from ${dir}`
        : "Used files at the plugin's root",
    };
  }

  for (const dir of ["", "dist/", "build/"]) {
    const r = await tryDir(dir);
    if (r) return r;
  }

  // 5. No committed artifacts — try building the plugin ourselves in a
  // sandboxed container. Returns null when there is no "build" script to run;
  // throws its own submitter-actionable errors when a build fails.
  const built = await buildBundleInSandbox(zip, prefix, manifest);
  if (built) return built;

  // Nothing matched — give the submitter actionable guidance.
  const expected = manifest.type === "theme" ? "theme.css" : entrypoint;
  const sub = prefix.split("/").slice(1, -1).join("/") || "";
  const where = sub || "the repo root";
  throw new Error(
    `Could not find ${expected} in the bundle. Looked in ${where}/, ${where}/dist/, ${where}/build/, and for ${where}/${manifest.slug}.zip. ` +
      `Either commit the built artifacts (check in dist/ or ship a prebuilt ${manifest.slug}.zip at ${where}/), ` +
      `or add a "build" script to ${where}/package.json — the server will then run npm install && npm run build in a sandbox and publish the output.`
  );
}

/**
 * Build a per-extension ZIP from a repo at ref/subpath and store it.
 */
export async function buildAndStoreBundle(
  repo: string,
  ref: string,
  subpath: string,
  manifest: NormalizedManifest
): Promise<{
  path: string;
  sha256: string;
  size: number;
  source: ResolvedBundle["source"];
  note: string;
}> {
  const zipBuf = await downloadRefArchive(repo, ref);
  const zip = await JSZip.loadAsync(zipBuf);

  const allEntries = Object.keys(zip.files);
  const topDirs = new Set(
    allEntries.map((e) => e.split("/")[0]).filter(Boolean)
  );
  if (topDirs.size !== 1) {
    throw new Error("Unexpected zipball structure");
  }
  const topDir = [...topDirs][0] + "/";
  const sub = subpath ? subpath.replace(/^\/+|\/+$/g, "") : "";
  const prefix = sub ? `${topDir}${sub}/` : topDir;

  if (!zip.file(`${prefix}manifest.json`)) {
    throw new Error(`No manifest.json found at ${sub || "repo root"}`);
  }

  const resolved = await resolveBundle(zip, prefix, manifest);

  if (resolved.files.size > MAX_BUNDLE_FILES) {
    throw new Error(`Bundle has too many files (>${MAX_BUNDLE_FILES})`);
  }

  const out = new JSZip();
  for (const [rel, data] of resolved.files) {
    out.file(rel, data);
  }

  const buf = await out.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  if (buf.length > MAX_BUNDLE_BYTES) {
    throw new Error(
      `Bundle exceeds ${(MAX_BUNDLE_BYTES / 1024 / 1024).toFixed(0)}MB limit`
    );
  }

  const stored = await storeBundleFile(manifest.slug, manifest.version, buf);
  return { ...stored, source: resolved.source, note: resolved.note };
}
