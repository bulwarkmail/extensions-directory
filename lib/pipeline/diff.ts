// What changed against the previous published version, for the reviewer:
// files added, removed and changed, and the manifest fields that widen what
// a plugin may do (permissions, origins, tier).
import crypto from "crypto";
import JSZip from "jszip";

export interface DiffSummary {
  previousVersion: string | null;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
  permissionsAdded: string[];
  permissionsRemoved: string[];
  originsAdded: Record<string, string[]>;
  tierChanged: { from: string | null; to: string | null } | null;
}

const ORIGIN_FIELDS = ["httpOrigins", "frameOrigins", "apiPostPaths"] as const;

const sha = (d: Uint8Array) => crypto.createHash("sha256").update(d).digest("hex");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

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
  const pm = previous?.manifest ?? {};
  const prevPerms = new Set(list(pm.permissions));
  const nextPerms = new Set(list(next.manifest.permissions));
  const originsAdded: Record<string, string[]> = {};
  for (const f of ORIGIN_FIELDS) {
    const before = new Set(list(pm[f]));
    const fresh = list(next.manifest[f]).filter((o) => !before.has(o));
    if (fresh.length) originsAdded[f] = fresh;
  }
  const tierFrom = typeof pm.tier === "string" ? pm.tier : null;
  const tierTo = typeof next.manifest.tier === "string" ? next.manifest.tier : null;
  return {
    previousVersion: previous?.version ?? null,
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    unchanged,
    permissionsAdded: [...nextPerms].filter((p) => !prevPerms.has(p)).sort(),
    permissionsRemoved: [...prevPerms].filter((p) => !nextPerms.has(p)).sort(),
    originsAdded,
    tierChanged: previous && tierFrom !== tierTo ? { from: tierFrom, to: tierTo } : null,
  };
}
