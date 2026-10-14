// An in-memory source host for tests: repositories with commits, refs and
// releases. Each commit has its own files, so code that builds from a ref
// instead of the pinned commit gets different content and is caught.
import JSZip from "jszip";
import type { RepoInfo, Source } from "@/lib/sources";

export interface FakeRepo {
  info: RepoInfo;
  refs: Record<string, string>;
  commits: Record<string, Record<string, string | Uint8Array>>;
  releases?: Record<string, string>;
}

export const repos = new Map<string, FakeRepo>();
export const calls: string[] = [];

export function sha(n: number | string): string {
  return String(n).padStart(40, "0").replace(/[^0-9a-f]/g, "a").slice(-40);
}

export function addRepo(name: string, r: Partial<FakeRepo> & { commits: FakeRepo["commits"] }): FakeRepo {
  const repo: FakeRepo = {
    info: { fullName: name, id: `id-${name}`, ownerId: `owner-${name.split("/")[0]}`, isPublic: true, defaultBranch: "main", ...r.info },
    refs: r.refs ?? {},
    commits: r.commits,
    releases: r.releases ?? {},
  };
  repos.set(name.toLowerCase(), repo);
  return repo;
}

function repo(name: string): FakeRepo | undefined {
  return repos.get(name.toLowerCase());
}

export const fakeSource: Source = {
  host: "github.com",
  async repoInfo(name) {
    calls.push(`info ${name}`);
    return repo(name)?.info ?? null;
  },
  async resolveRef(name, ref) {
    calls.push(`resolve ${name} ${ref}`);
    const r = repo(name);
    if (!r) return null;
    if (r.commits[ref]) return ref;
    return r.refs[ref] ?? r.refs[ref.replace(/^refs\/(tags|heads)\//, "")] ?? null;
  },
  async archive(name, commit) {
    calls.push(`archive ${name} ${commit}`);
    const files = repo(name)?.commits[commit];
    if (!files) throw new Error(`no commit ${commit}`);
    const zip = new JSZip();
    const top = `${name.replace("/", "-")}-${commit.slice(0, 7)}/`;
    for (const [p, c] of Object.entries(files)) zip.file(top + p, c);
    return zip.generateAsync({ type: "nodebuffer" });
  },
  async file(name, commit, path) {
    calls.push(`file ${name} ${commit} ${path}`);
    const c = repo(name)?.commits[commit]?.[path];
    return c === undefined ? null : Buffer.from(c);
  },
  async releaseNotes(name, tag) {
    return repo(name)?.releases?.[tag] ?? null;
  },
  repoUrl: (n) => `https://github.com/${n}`,
  commitUrl: (n, s) => `https://github.com/${n}/commit/${s}`,
};

export function resetFakes(): void {
  repos.clear();
  calls.length = 0;
}

/** A plugin that installs on the webmail, as plain files (no build step). */
export function plainPlugin(id: string, version: string, extra: Record<string, unknown> = {}, code = "export default { activate() {} };\n") {
  return {
    "manifest.json": JSON.stringify({ id, name: id, version, author: "Test", description: "A test plugin", type: "hook", entrypoint: "index.js", permissions: ["email:read"], ...extra }),
    "index.js": code,
    "README.md": "# docs\n",
  };
}
