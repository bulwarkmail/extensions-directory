// What a webmail grants an extension when it installs it, read with the
// vendored webmail check (checkPluginManifest) so the directory can't count
// differently from the webmail. The review screen, the stored version row,
// the listing API and the public pages all take it from here.
//
// A plugin is granted its `permissions` plus every optional permission the
// webmail knows, runs in its tier, may reach the hosts in `httpOrigins`, post
// to the app routes in `apiPostPaths`, embed `frameOrigins`, and have its
// credentials sent to the servers named under `credentials`. A theme is
// granted none of this.
import type Database from "better-sqlite3";
import { checkPluginManifest } from "./vendor/extension-package";
import { ALL_PERMISSIONS, DEPRECATED_PERMISSIONS } from "./vendor/plugin-types";

export type Tier = "untrusted" | "privileged";

/** One credential, and where the webmail sends its secret. */
export interface CredentialGrant {
  id: string;
  label: string;
  /** "admin": the admin enters the secret once; "user": each user connects their own account. */
  scope: "admin" | "user";
  /**
   * Who decides the server: the manifest (a fixed origin), the admin (a
   * setting named by `originKey`), or each user (a user credential without
   * a fixed origin).
   */
  setBy: "manifest" | "admin" | "user";
  /** The fixed origin, or for a server the admin sets, the default the manifest brings for it. */
  origin: string | null;
}

export interface Grant {
  /** What the webmail grants: `permissions` plus the optional permissions it knows. */
  permissions: string[];
  /** The part of `permissions` that is asked for under `optionalPermissions` only. */
  optionalPermissions: string[];
  /** Names under `optionalPermissions` the webmail doesn't know; it leaves them out. */
  unknownOptionalPermissions: string[];
  /** "untrusted" unless the manifest asks for "privileged"; null for a theme. */
  tier: Tier | null;
  httpOrigins: string[];
  apiPostPaths: string[];
  frameOrigins: string[];
  credentials: CredentialGrant[];
  /**
   * The servers credentials are sent to, as the webmail counts them: each
   * fixed origin, and for a server the admin sets, the default the manifest
   * brings for that setting.
   */
  credentialOrigins: string[];
  /**
   * False when the webmail check refuses the manifest. The lists then hold
   * every name the manifest asks for, so nothing is left out.
   */
  checked: boolean;
}

const KNOWN = new Set<string>(ALL_PERMISSIONS as readonly string[]);
const DEPRECATED = new Set<string>(DEPRECATED_PERMISSIONS as readonly string[]);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string"))] : [];

function urlOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function credentialGrants(credentials: unknown, configSchema: unknown): CredentialGrant[] {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return [];
  const schema = (configSchema && typeof configSchema === "object" ? configSchema : {}) as Record<string, { default?: unknown } | undefined>;
  const out: CredentialGrant[] = [];
  for (const [id, spec] of Object.entries(credentials as Record<string, unknown>)) {
    if (!spec || typeof spec !== "object") continue;
    const s = spec as { label?: unknown; scope?: unknown; origin?: unknown; originKey?: unknown };
    const label = typeof s.label === "string" && s.label.trim() ? s.label : id;
    const scope = s.scope === "admin" ? "admin" : "user";
    const fixed = urlOrigin(s.origin);
    if (fixed) out.push({ id, label, scope, setBy: "manifest", origin: fixed });
    else if (scope === "admin") {
      const key = typeof s.originKey === "string" && Object.hasOwn(schema, s.originKey) ? s.originKey : null;
      out.push({ id, label, scope, setBy: "admin", origin: key ? urlOrigin(schema[key]?.default) : null });
    } else out.push({ id, label, scope, setBy: "user", origin: null });
  }
  return out;
}

const originsOf = (credentials: CredentialGrant[]) =>
  [...new Set(credentials.map((c) => c.origin).filter((o): o is string => !!o))];

const THEME: Grant = {
  permissions: [], optionalPermissions: [], unknownOptionalPermissions: [], tier: null,
  httpOrigins: [], apiPostPaths: [], frameOrigins: [], credentials: [], credentialOrigins: [], checked: true,
};

/** What a webmail grants the extension with this manifest.json. */
export function grantOf(manifest: unknown): Grant {
  const m = (manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest : {}) as Record<string, unknown>;
  if (m.type === "theme") return { ...THEME };
  const asked = strings(m.permissions);
  const optional = strings(m.optionalPermissions);
  const unknownOptionalPermissions = optional.filter((p) => !KNOWN.has(p) && !DEPRECATED.has(p));
  const check = checkPluginManifest(m);
  if (check.manifest) {
    const v = check.manifest as unknown as {
      permissions: string[]; tier?: string; httpOrigins?: string[]; apiPostPaths?: string[]; frameOrigins?: string[];
      credentials?: unknown; configSchema?: unknown;
    };
    const permissions = [...v.permissions];
    const credentials = credentialGrants(v.credentials, v.configSchema);
    return {
      permissions,
      optionalPermissions: permissions.filter((p) => optional.includes(p) && !asked.includes(p)),
      unknownOptionalPermissions,
      tier: v.tier === "privileged" ? "privileged" : "untrusted",
      httpOrigins: [...(v.httpOrigins ?? [])],
      apiPostPaths: [...(v.apiPostPaths ?? [])],
      frameOrigins: [...(v.frameOrigins ?? [])],
      credentials,
      credentialOrigins: originsOf(credentials),
      checked: true,
    };
  }
  const credentials = credentialGrants(m.credentials, m.configSchema);
  return {
    permissions: [...new Set([...asked, ...optional])],
    optionalPermissions: optional.filter((p) => !asked.includes(p)),
    unknownOptionalPermissions,
    tier: m.tier === "privileged" ? "privileged" : "untrusted",
    httpOrigins: strings(m.httpOrigins),
    apiPostPaths: strings(m.apiPostPaths),
    frameOrigins: strings(m.frameOrigins),
    credentials,
    credentialOrigins: originsOf(credentials),
    checked: false,
  };
}

/** How a credential's server reads for people: the origin, or who sets it. */
export function credentialTarget(c: CredentialGrant): string {
  if (c.setBy === "manifest") return c.origin ?? "";
  if (c.setBy === "admin") return c.origin ? `set by the admin, default ${c.origin}` : "set by the admin";
  return "entered by each user";
}

/**
 * Write each published version's granted permissions into its stored
 * `permissions` column, which the extension-level copy (lib/release-caches.ts)
 * and the v1 lists read. Returns how many rows changed (or would change).
 */
export function rederiveStoredPermissions(sqlite: Database.Database, dryRun = false): number {
  const rows = sqlite.prepare("select id, permissions, manifest from extension_versions").all() as { id: string; permissions: string | null; manifest: string | null }[];
  const update = sqlite.prepare("update extension_versions set permissions = ? where id = ?");
  let changed = 0;
  const tx = sqlite.transaction(() => {
    for (const r of rows) {
      let manifest: unknown;
      try {
        manifest = r.manifest ? JSON.parse(r.manifest) : null;
      } catch {
        continue;
      }
      if (!manifest || typeof manifest !== "object") continue;
      const next = JSON.stringify(grantOf(manifest).permissions);
      if (next === (r.permissions ?? "[]")) continue;
      changed++;
      if (!dryRun) update.run(next, r.id);
    }
  });
  tx();
  return changed;
}
