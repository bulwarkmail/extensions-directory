// The webmail's own install checks (vendored by scripts/sync-webmail-compat.mjs),
// wrapped for the directory. A bundle passes here exactly when a webmail of
// the vendored version would install it from the marketplace.
import {
  ExtensionPackageError,
  compareVersions as webmailCompareVersions,
  readPluginPackage,
  readThemePackage,
} from "./vendor/extension-package";
import {
  ALL_PERMISSIONS,
  ALLOWED_PLUGIN_FILES,
  DEPRECATED_PERMISSIONS,
  IMPLICIT_PERMISSIONS,
  MAX_PLUGIN_SIZE,
  MAX_THEME_SIZE,
} from "./vendor/plugin-types";
import { MAX_ZIP_ENTRIES } from "./vendor/extension-package";
import permissionTexts from "./vendor/permission-texts.json";

export const KNOWN_PERMISSIONS: readonly string[] = ALL_PERMISSIONS as readonly string[];
export const IMPLICIT: readonly string[] = IMPLICIT_PERMISSIONS as readonly string[];
export const DEPRECATED: readonly string[] = DEPRECATED_PERMISSIONS;
export const LIMITS = {
  pluginBytes: MAX_PLUGIN_SIZE as number,
  themeBytes: MAX_THEME_SIZE as number,
  zipEntries: MAX_ZIP_ENTRIES as number,
  pluginFileTypes: [...(ALLOWED_PLUGIN_FILES as Set<string>)],
};

/** Same rules as the webmail's consent dialog (lib/plugin-sandbox/permission-text.ts). */
export const HIGH_RISK_PERMISSIONS: ReadonlySet<string> = new Set([
  "crypto:full", "email:read", "email:send", "email:raw-send", "email:blob-read",
  "email:blob-write", "email:render-takeover", "http:fetch", "http:post",
  "filters:write", "http:proxy", "identity:write", "vacation:write",
]);

export function permissionKey(perm: string): string {
  return perm.replace(/[:-]/g, "_");
}

/** The title and description the webmail shows for a permission, if it has one. */
export function permissionText(perm: string): { title: string; body: string } | null {
  const entry = (permissionTexts as Record<string, unknown>)[permissionKey(perm)];
  if (entry && typeof entry === "object" && "title" in entry) {
    const e = entry as { title?: unknown; body?: unknown };
    return { title: String(e.title ?? perm), body: String(e.body ?? "") };
  }
  return null;
}

export function compareVersions(a: string, b: string): number {
  return webmailCompareVersions(a, b);
}

export interface CompatResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest: Record<string, unknown> | null;
}

/**
 * Run the webmail's marketplace install checks on a bundle zip. `expectedId`
 * is the slug the directory would publish it under.
 */
export async function checkBundle(
  zip: Uint8Array,
  kind: "plugin" | "theme",
  expectedId: string,
  appVersion?: string
): Promise<CompatResult> {
  try {
    if (kind === "plugin") {
      const pkg = await readPluginPackage(zip, { expectedId, appVersion });
      return { ok: true, errors: [], warnings: pkg.warnings, manifest: pkg.manifest as unknown as Record<string, unknown> };
    }
    const read = await readThemePackage(zip, {});
    const errors = [...(read.errors ?? [])];
    if (read.valid && read.manifest && read.manifest.id !== expectedId) {
      errors.push(`Bundle id "${String(read.manifest.id)}" does not match "${expectedId}"`);
    }
    return {
      ok: !!read.valid && errors.length === 0,
      errors,
      warnings: read.warnings ?? [],
      manifest: (read.manifest as unknown as Record<string, unknown>) ?? null,
    };
  } catch (err) {
    if (err instanceof ExtensionPackageError) {
      return { ok: false, errors: err.message.split("; "), warnings: [], manifest: null };
    }
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)], warnings: [], manifest: null };
  }
}
