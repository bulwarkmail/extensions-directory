// Where extension source code comes from: github.com, gitlab.com and
// codeberg.org, each behind the same small interface. Repositories must be
// public; every fetch is pinned to a commit SHA once the ref is resolved.
import { getJson, get, SourceError } from "./http";
import type { SourceHost } from "@/lib/db/schema";

export { SourceError };

export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

export interface RepoInfo {
  /** Canonical owner/name as the host spells it. */
  fullName: string;
  /** Numeric ids that survive renames and deletion-and-recreation. */
  id: string;
  ownerId: string;
  isPublic: boolean;
  defaultBranch: string;
}

export interface Source {
  host: SourceHost;
  repoInfo(repo: string): Promise<RepoInfo | null>;
  /** Commit SHA for a branch, tag or SHA, or null when it doesn't exist. */
  resolveRef(repo: string, ref: string): Promise<string | null>;
  archive(repo: string, sha: string): Promise<Buffer>;
  file(repo: string, sha: string, path: string, maxBytes: number): Promise<Buffer | null>;
  releaseNotes(repo: string, tag: string): Promise<string | null>;
  repoUrl(repo: string): string;
  commitUrl(repo: string, sha: string): string;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const enc = (s: string) => encodeURIComponent(s);
const encPath = (p: string) => p.split("/").map(enc).join("/");

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (token) return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const id = process.env.GITHUB_CLIENT_ID;
  const secret = process.env.GITHUB_CLIENT_SECRET;
  if (id && secret) return { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, Accept: "application/vnd.github+json" };
  return { Accept: "application/vnd.github+json" };
}

const github: Source = {
  host: "github.com",
  async repoInfo(repo) {
    const r = await getJson<{ id: number; full_name: string; private: boolean; visibility?: string; default_branch: string; owner: { id: number } }>(
      `https://api.github.com/repos/${repo}`, { headers: githubHeaders() });
    if (!r) return null;
    return { fullName: r.full_name, id: String(r.id), ownerId: String(r.owner.id), isPublic: r.private === false, defaultBranch: r.default_branch };
  },
  async resolveRef(repo, ref) {
    const r = await getJson<{ sha?: string }>(`https://api.github.com/repos/${repo}/commits/${enc(ref)}`, { headers: githubHeaders() }).catch((e) => {
      if (e instanceof SourceError && e.status === 422) return null;
      throw e;
    });
    return r?.sha && SHA_RE.test(r.sha) ? r.sha : null;
  },
  async archive(repo, sha) {
    const b = await get(`https://api.github.com/repos/${repo}/zipball/${sha}`, { headers: githubHeaders(), maxBytes: MAX_ARCHIVE_BYTES, timeoutMs: 120_000 });
    if (!b) throw new SourceError(`No archive for ${repo}@${sha}`);
    return b;
  },
  file(repo, sha, path, maxBytes) {
    return get(`https://raw.githubusercontent.com/${repo}/${sha}/${encPath(path)}`, { maxBytes });
  },
  async releaseNotes(repo, tag) {
    const r = await getJson<{ body?: string | null }>(`https://api.github.com/repos/${repo}/releases/tags/${enc(tag)}`, { headers: githubHeaders() });
    return r?.body?.trim() || null;
  },
  repoUrl: (repo) => `https://github.com/${repo}`,
  commitUrl: (repo, sha) => `https://github.com/${repo}/commit/${sha}`,
};

const gitlab: Source = {
  host: "gitlab.com",
  async repoInfo(repo) {
    const r = await getJson<{ id: number; path_with_namespace: string; visibility: string; default_branch: string; namespace: { id: number } }>(
      `https://gitlab.com/api/v4/projects/${enc(repo)}`);
    if (!r) return null;
    return { fullName: r.path_with_namespace, id: String(r.id), ownerId: String(r.namespace.id), isPublic: r.visibility === "public", defaultBranch: r.default_branch };
  },
  async resolveRef(repo, ref) {
    const r = await getJson<{ id?: string }>(`https://gitlab.com/api/v4/projects/${enc(repo)}/repository/commits/${enc(ref)}`);
    return r?.id && SHA_RE.test(r.id) ? r.id : null;
  },
  async archive(repo, sha) {
    const b = await get(`https://gitlab.com/api/v4/projects/${enc(repo)}/repository/archive.zip?sha=${sha}`, { maxBytes: MAX_ARCHIVE_BYTES, timeoutMs: 120_000 });
    if (!b) throw new SourceError(`No archive for ${repo}@${sha}`);
    return b;
  },
  file(repo, sha, path, maxBytes) {
    return get(`https://gitlab.com/api/v4/projects/${enc(repo)}/repository/files/${enc(path)}/raw?ref=${sha}`, { maxBytes });
  },
  async releaseNotes(repo, tag) {
    const r = await getJson<{ description?: string | null }>(`https://gitlab.com/api/v4/projects/${enc(repo)}/releases/${enc(tag)}`);
    return r?.description?.trim() || null;
  },
  repoUrl: (repo) => `https://gitlab.com/${repo}`,
  commitUrl: (repo, sha) => `https://gitlab.com/${repo}/-/commit/${sha}`,
};

const codeberg: Source = {
  host: "codeberg.org",
  async repoInfo(repo) {
    const r = await getJson<{ id: number; full_name: string; private: boolean; default_branch: string; owner: { id: number } }>(
      `https://codeberg.org/api/v1/repos/${repo}`);
    if (!r) return null;
    return { fullName: r.full_name, id: String(r.id), ownerId: String(r.owner.id), isPublic: r.private === false, defaultBranch: r.default_branch };
  },
  async resolveRef(repo, ref) {
    const r = await getJson<{ sha?: string }[]>(`https://codeberg.org/api/v1/repos/${repo}/commits?sha=${enc(ref)}&limit=1&stat=false&verification=false&files=false`);
    const sha = r?.[0]?.sha;
    // A SHA prefix also matches; insist on the full commit the caller gave.
    if (!sha || !SHA_RE.test(sha)) return null;
    if (/^[0-9a-f]{7,40}$/.test(ref) && !sha.startsWith(ref)) return null;
    return sha;
  },
  async archive(repo, sha) {
    const b = await get(`https://codeberg.org/api/v1/repos/${repo}/archive/${sha}.zip`, { maxBytes: MAX_ARCHIVE_BYTES, timeoutMs: 120_000 });
    if (!b) throw new SourceError(`No archive for ${repo}@${sha}`);
    return b;
  },
  file(repo, sha, path, maxBytes) {
    return get(`https://codeberg.org/api/v1/repos/${repo}/raw/${encPath(path)}?ref=${sha}`, { maxBytes });
  },
  async releaseNotes(repo, tag) {
    const r = await getJson<{ body?: string | null }>(`https://codeberg.org/api/v1/repos/${repo}/releases/tags/${enc(tag)}`);
    return r?.body?.trim() || null;
  },
  repoUrl: (repo) => `https://codeberg.org/${repo}`,
  commitUrl: (repo, sha) => `https://codeberg.org/${repo}/commit/${sha}`,
};

const SOURCES: Record<SourceHost, Source> = { "github.com": github, "gitlab.com": gitlab, "codeberg.org": codeberg };

export function source(host: string): Source {
  const s = SOURCES[host as SourceHost];
  if (!s) throw new SourceError(`Unsupported source host ${host}`);
  return s;
}

const SEGMENT = "[A-Za-z0-9._-]+";
const REPO_RE: Record<SourceHost, RegExp> = {
  "github.com": new RegExp(`^${SEGMENT}/${SEGMENT}$`),
  // GitLab allows nested groups.
  "gitlab.com": new RegExp(`^${SEGMENT}(?:/${SEGMENT}){1,5}$`),
  "codeberg.org": new RegExp(`^${SEGMENT}/${SEGMENT}$`),
};

export function isValidRepo(host: SourceHost, repo: string): boolean {
  return REPO_RE[host].test(repo) && !repo.split("/").some((s) => s === "." || s === "..");
}

/**
 * Parse "owner/repo" (GitHub), or a repository URL on any supported host,
 * optionally with /tree/<ref>/<subpath> (GitHub, Codeberg: /src/branch/<ref>,
 * GitLab: /-/tree/<ref>).
 */
export function parseRepoUrl(input: string): { host: SourceHost; repo: string; ref?: string; subpath?: string } | null {
  const raw = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (!raw.includes("://")) {
    return isValidRepo("github.com", raw) ? { host: "github.com", repo: raw } : null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname as SourceHost;
  if (!(host in SOURCES)) return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let repoParts: string[];
  let rest: string[] = [];
  if (host === "gitlab.com") {
    const dash = parts.indexOf("-");
    repoParts = dash === -1 ? parts : parts.slice(0, dash);
    if (dash !== -1 && parts[dash + 1] === "tree") rest = parts.slice(dash + 2);
  } else {
    repoParts = parts.slice(0, 2);
    if (host === "github.com" && (parts[2] === "tree" || parts[2] === "blob")) rest = parts.slice(3);
    if (host === "codeberg.org" && parts[2] === "src" && ["branch", "tag", "commit"].includes(parts[3])) rest = parts.slice(4);
  }
  const repo = repoParts.join("/").replace(/\.git$/, "");
  if (!isValidRepo(host, repo)) return null;
  const [ref, ...sub] = rest;
  return { host, repo, ...(ref ? { ref } : {}), ...(sub.length ? { subpath: sub.join("/") } : {}) };
}

/** Normalize a subpath; null when it would leave the repository. */
export function cleanSubpath(subpath: string | undefined | null): string | null {
  const s = (subpath ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!s) return "";
  if (s.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  if (!/^[A-Za-z0-9._\-/@ ]+$/.test(s) || s.length > 200) return null;
  return s;
}
