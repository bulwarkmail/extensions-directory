// The v1 response shapes, field by field. Deployed webmails read these, so
// the keys are frozen (tests/v1/responses.test.ts snapshots them). Building
// them from explicit lists means a new database column never shows up in
// v1 by accident, and private columns can be blanked while the key stays.
type Row = Record<string, unknown>;

function pick(row: Row, keys: readonly string[], blank: readonly string[] = []): Row {
  const out: Row = {};
  for (const k of keys) out[k] = blank.includes(k) ? null : (row[k] ?? null);
  return out;
}

const AUTHOR_KEYS = [
  "id", "githubId", "githubLogin", "displayName", "avatarUrl", "email", "bio",
  "website", "verified", "banned", "createdAt", "updatedAt",
] as const;

const EXTENSION_KEYS = [
  "id", "slug", "name", "type", "pluginType", "authorId", "description",
  "longDescription", "githubRepo", "subpath", "license", "iconPath", "bannerPath",
  "status", "featured", "permissions", "tags", "minAppVersion", "totalDownloads",
  "createdAt", "updatedAt",
] as const;

const VERSION_KEYS = [
  "id", "extensionId", "version", "changelog", "bundlePath", "bundleSha256",
  "bundleSize", "permissions", "minAppVersion", "manifest", "scanStatus",
  "scanReport", "reviewStatus", "reviewerId", "reviewNotes", "publishedAt",
  "createdAt",
] as const;

const SCREENSHOT_KEYS = ["id", "extensionId", "path", "altText", "sortOrder", "createdAt"] as const;
const PREVIEW_KEYS = ["id", "extensionId", "variant", "previewPath", "colors"] as const;

/** An author as anyone may see them: never their email address. */
export function v1Author(row: Row | null | undefined): Row | null {
  return row ? pick(row, AUTHOR_KEYS, ["email"]) : null;
}

/** A published version without the reviewer's notes or the scan report. */
export function v1Version(row: Row): Row {
  return pick(row, VERSION_KEYS, ["scanReport", "reviewerId", "reviewNotes"]);
}

/** One entry of /extensions and of the featured, popular and recent lists. */
export function v1ListItem(row: Row & { author?: Row | null; latestVersion?: unknown }, withLatest: boolean): Row {
  return {
    ...pick(row, EXTENSION_KEYS),
    author: v1Author(row.author),
    ...(withLatest ? { latestVersion: row.latestVersion ?? null } : {}),
  };
}

/** The body of /extension/{slug}. */
export function v1Detail(row: Row & {
  author?: Row | null;
  versions: Row[];
  screenshots: Row[];
  themePreviews: Row[];
  latestVersion: Row | null;
}): Row {
  return {
    ...pick(row, EXTENSION_KEYS),
    author: v1Author(row.author),
    versions: row.versions.map(v1Version),
    screenshots: row.screenshots.map((s) => pick(s, SCREENSHOT_KEYS)),
    themePreviews: row.themePreviews.map((p) => pick(p, PREVIEW_KEYS)),
    latestVersion: row.latestVersion ? v1Version(row.latestVersion) : null,
  };
}
