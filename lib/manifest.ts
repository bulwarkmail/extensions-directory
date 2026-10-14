// Reads the parts of manifest.json the directory itself needs (slug, type,
// version, media paths). Whether a webmail would install the bundle is
// decided by lib/webmail-compat, which runs the webmail's own checks.

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

