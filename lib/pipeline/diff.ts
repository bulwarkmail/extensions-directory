// What changed against the previous published version, for the reviewer:
// files added, removed and changed, and what a webmail newly grants
// (lib/webmail-compat/grants.ts): permissions with the optional ones, the
// three origin lists, the servers credentials are sent to, and the tier. A
// first version is compared with nothing, so all it is granted is new.
import crypto from "crypto";
import JSZip from "jszip";
import { credentialTarget, grantOf } from "@/lib/webmail-compat/grants";

export interface DiffSummary {
  previousVersion: string | null;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
  /** Granted now and not before, optional permissions included. */
  permissionsAdded: string[];
  permissionsRemoved: string[];
  /** Of the new permissions, those asked for under optionalPermissions only. */
  optionalPermissionsAdded: string[];
  /** This version newly asks for the certificates on people's computers: look at it twice. */
  keystoreAdded: boolean;
  /** New entries of httpOrigins, frameOrigins and apiPostPaths, and new servers credentials go to ("credentials"). */
  originsAdded: Record<string, string[]>;
  /** A changed tier; on a first version, { from: null, to: "privileged" } for a privileged plugin. */
  tierChanged: { from: string | null; to: string | null } | null;
}

const ORIGIN_FIELDS = ["httpOrigins", "frameOrigins", "apiPostPaths"] as const;

const sha = (d: Uint8Array) => crypto.createHash("sha256").update(d).digest("hex");

export async function readZipFiles(zipBytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(zipBytes);
  const out = new Map<string, Uint8Array>();
  for (const [name, f] of Object.entries(zip.files)) if (!f.dir) out.set(name, await f.async("uint8array"));
  return out;
}

export function diffBundles(
  previous: { version: string; files: Map<string, Uint8Array>; manifest: Record<string, unknown> } | null,
  next: { files: Map<string, Uint8Array>; manifest: Record<string, unknown> }
): DiffSummary {
  const prevFiles = previous?.files ?? new Map<string, Uint8Array>();
  const prevHashes = new Map([...prevFiles].map(([k, v]) => [k, sha(v)]));
  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const [name, data] of next.files) {
    const h = prevHashes.get(name);
    if (h === undefined) added.push(name);
    else if (h !== sha(data)) changed.push(name);
    else unchanged++;
  }
  const removed = [...prevFiles.keys()].filter((k) => !next.files.has(k));
  const before = previous ? grantOf(previous.manifest) : null;
  const after = grantOf(next.manifest);
  const prevPerms = new Set(before?.permissions ?? []);
  const nextPerms = new Set(after.permissions);
  const originsAdded: Record<string, string[]> = {};
  for (const f of ORIGIN_FIELDS) {
    const old = new Set(before?.[f] ?? []);
    const fresh = after[f].filter((o) => !old.has(o));
    if (fresh.length) originsAdded[f] = fresh;
  }
  const oldTargets = new Set((before?.credentials ?? []).map(credentialTarget));
  const freshTargets = [...new Set(after.credentials.map(credentialTarget))].filter((t) => !oldTargets.has(t));
  if (freshTargets.length) originsAdded.credentials = freshTargets;
  const tierChanged = before
    ? before.tier !== after.tier ? { from: before.tier, to: after.tier } : null
    : after.tier === "privileged" ? { from: null, to: "privileged" } : null;
  return {
    previousVersion: previous?.version ?? null,
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    unchanged,
    permissionsAdded: [...nextPerms].filter((p) => !prevPerms.has(p)).sort(),
    permissionsRemoved: [...prevPerms].filter((p) => !nextPerms.has(p)).sort(),
    optionalPermissionsAdded: after.optionalPermissions.filter((p) => !prevPerms.has(p)).sort(),
    keystoreAdded: nextPerms.has("keystore") && !prevPerms.has("keystore"),
    originsAdded,
    tierChanged,
  };
}
