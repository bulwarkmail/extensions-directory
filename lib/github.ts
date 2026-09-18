const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001";
const GITHUB_CALLBACK_URL = `${SITE_URL}/api/v1/auth/github/callback`;

/**
 * Build an Authorization header for api.github.com calls.
 *
 * GITHUB_TOKEN (a personal access token, classic or fine-grained) is preferred
 * when set; otherwise we fall back to Basic auth with the OAuth app's
 * client_id:client_secret, which is enough to lift the rate limit from
 * 60 req/hr per IP (unauthenticated) to 5000 req/hr per app.
 */
function githubAuthHeader(): string | null {
  const token = process.env.GITHUB_TOKEN;
  if (token) return `Bearer ${token}`;
  if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
    const basic = Buffer.from(
      `${GITHUB_CLIENT_ID}:${GITHUB_CLIENT_SECRET}`
    ).toString("base64");
    return `Basic ${basic}`;
  }
  return null;
}

function ghHeaders(extra: Record<string, string> = {}): HeadersInit {
  const auth = githubAuthHeader();
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "bulwarkmail-extension-directory",
    ...(auth ? { Authorization: auth } : {}),
    ...extra,
  };
}

export function getGitHubAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_CALLBACK_URL,
    scope: "read:user user:email",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_CALLBACK_URL,
    }),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }
  return data.access_token;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
  bio: string | null;
  blog: string | null;
}

export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "bulwarkmail-extension-directory",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch GitHub user");
  }

  return response.json();
}

export async function verifyRepoIsPublic(repo: string): Promise<boolean> {
  const response = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: ghHeaders(),
    cache: "no-store",
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.private === false;
}

export async function getRepoLicense(repo: string): Promise<string | null> {
  const response = await fetch(`https://api.github.com/repos/${repo}/license`, {
    headers: ghHeaders(),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.license?.spdx_id || null;
}

export async function getTagArchiveUrl(
  repo: string,
  tag: string
): Promise<string> {
  return `https://api.github.com/repos/${repo}/zipball/refs/tags/${tag}`;
}

export async function downloadTagArchive(
  repo: string,
  tag: string
): Promise<Buffer> {
  const url = `https://api.github.com/repos/${repo}/zipball/refs/tags/${tag}`;
  const response = await fetch(url, {
    headers: ghHeaders(),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to download archive for ${repo}@${tag}: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── URL parsing & ref-based archive download ────────────────────────────

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
}

const GITHUB_URL_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/\s]+)(?:\/(.+?))?)?\/?$/;

/**
 * Parse a GitHub URL into its parts.
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/<ref>
 *   https://github.com/owner/repo/tree/<ref>/<subpath>
 *   https://github.com/owner/repo.git
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  const m = url.trim().match(GITHUB_URL_RE);
  if (!m) return null;
  const subpath = m[4]?.replace(/\/+$/, "") || undefined;
  return {
    owner: m[1],
    repo: m[2].replace(/\.git$/, ""),
    ref: m[3] || undefined,
    subpath: subpath || undefined,
  };
}

export async function getDefaultBranch(repo: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: ghHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch repo metadata for ${repo}: ${res.status}`);
  }
  const data = await res.json();
  return (data.default_branch as string) || "main";
}

/**
 * Resolves a ref (branch / tag / commit SHA) to its current commit SHA.
 * Returns null if the ref does not exist. The commits API is not subject to
 * the long CDN cache that raw.githubusercontent.com applies to branch refs,
 * so callers should pin downstream fetches to the resolved SHA when they want
 * the latest commit on a moving ref.
 */
export async function resolveRefSha(
  repo: string,
  ref: string
): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`,
    {
      headers: ghHeaders(),
      cache: "no-store",
    }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { sha?: unknown };
  return typeof data.sha === "string" ? data.sha : null;
}

/**
 * Returns true if `ref` resolves to a real commit in the repo (works for
 * branch names, tag names, and commit SHAs).
 */
export async function verifyRef(repo: string, ref: string): Promise<boolean> {
  return (await resolveRefSha(repo, ref)) !== null;
}

/**
 * Returns "directory" / "file" / null based on what's at <path> on <ref>.
 * Returns null if the path is missing.
 */
export async function statRepoPath(
  repo: string,
  ref: string,
  path: string
): Promise<"directory" | "file" | null> {
  const cleaned = path.replace(/^\/+|\/+$/g, "");
  const url = cleaned
    ? `https://api.github.com/repos/${repo}/contents/${cleaned
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(ref)}`
    : `https://api.github.com/repos/${repo}/contents/?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    headers: ghHeaders(),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to stat ${path} in ${repo}@${ref}: ${res.status}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) return "directory"; // listing
  if (data && typeof data === "object" && "type" in data) {
    return (data as { type: string }).type === "dir" ? "directory" : "file";
  }
  return null;
}

/**
 * Fetch a file from a repo at a specific ref. `repo` is "owner/name".
 * Returns null if the file is missing.
 */
export async function fetchRepoFile(
  repo: string,
  ref: string,
  path: string
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(
    ref
  )}/${path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")}`;
  const res = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path} from ${repo}@${ref}: ${res.status}`);
  }
  return res.text();
}

/**
 * Download the zipball of a repo at a specific ref (branch/tag/commit).
 * Returns the raw bytes of the ZIP archive.
 */
export async function downloadRefArchive(
  repo: string,
  ref: string
): Promise<Buffer> {
  const url = `https://api.github.com/repos/${repo}/zipball/${encodeURIComponent(
    ref
  )}`;
  const res = await fetch(url, {
    headers: ghHeaders(),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Failed to download archive for ${repo}@${ref}: ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}
