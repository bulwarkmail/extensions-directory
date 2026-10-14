// Signing in with GitHub (OAuth web flow). Scopes: read:user for the
// profile, user:email for the verified primary address notifications go to.
const CLIENT_ID = () => process.env.GITHUB_CLIENT_ID || "";
const CLIENT_SECRET = () => process.env.GITHUB_CLIENT_SECRET || "";
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001").replace(/\/+$/, "");
export const CALLBACK_PATH = "/api/v1/auth/github/callback";

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID(),
    redirect_uri: `${SITE()}${CALLBACK_PATH}`,
    scope: "read:user user:email",
    state,
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(), code, redirect_uri: `${SITE()}${CALLBACK_PATH}` }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) throw new Error(`GitHub sign-in failed: ${data.error_description || data.error || res.status}`);
  return data.access_token;
}

export interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  blog: string | null;
  email: string | null;
}

export async function fetchProfile(token: string): Promise<GitHubProfile> {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "bulwarkmail-extension-directory" };
  const res = await fetch("https://api.github.com/user", { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error("Could not read the GitHub profile");
  const u = (await res.json()) as { id: number; login: string; name: string | null; avatar_url: string; bio: string | null; blog: string | null };
  // Only an address GitHub has verified; the public profile address may not be.
  let email: string | null = null;
  const emails = await fetch("https://api.github.com/user/emails", { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (emails?.ok) {
    const list = (await emails.json()) as { email: string; primary: boolean; verified: boolean }[];
    email = list.find((e) => e.primary && e.verified)?.email ?? null;
  }
  return { id: u.id, login: u.login, name: u.name, avatarUrl: u.avatar_url, bio: u.bio, blog: u.blog, email };
}

/** Only paths on this site, never another host ("//evil", "/\\evil", "https:..."). */
export function safeReturnTo(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\r\n]/.test(value)) return fallback;
  return value.slice(0, 500);
}
