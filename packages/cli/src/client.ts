// The publishing client shared by the CLI and the GitHub Action. Plain
// fetch, no dependencies. Talks to /api/v2/publish, /publish/dry-run and
// /submissions/{id}.

export const DEFAULT_DIRECTORY = "https://extensions.bulwarkmail.org";

export interface Submission {
  id: string;
  slug: string | null;
  version: string | null;
  status: string;
  dryRun: boolean;
  error: string | null;
  url: string;
  statusUrl: string;
  pollToken?: string;
  source: { host: string; repo: string; ref: string; commit: string | null; subpath: string };
  checks: {
    webmail: { ok: boolean; errors: string[]; warnings: string[]; version: string | null } | null;
    scan: { findings: { severity: string; rule: string; message: string; file?: string; line?: number }[] } | null;
  };
  buildLog?: string | null;
}

export class PublishError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
  }
}

/** Statuses after which nothing changes without a person. */
export const SETTLED = new Set(["awaiting_review", "publishing", "approved", "rejected", "withdrawn", "build_failed", "blocked", "dry_run_passed", "dry_run_failed"]);
export const FAILED = new Set(["build_failed", "blocked", "dry_run_failed", "rejected"]);

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", "User-Agent": "bulwarkmail-extension-cli", ...init.headers } });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
  if (!res.ok) throw new PublishError(body.error?.message ?? `${res.status} ${res.statusText}`, res.status, body.error?.code);
  return body.data as T;
}

/** A GitHub Actions OIDC token for the directory, when running in a job with id-token: write. */
export async function githubOidcToken(audience: string): Promise<string | null> {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) return null;
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}audience=${encodeURIComponent(audience)}`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new PublishError(`Could not get an OIDC token from GitHub (${res.status}). Does the job have "permissions: id-token: write"?`);
  const { value } = (await res.json()) as { value?: string };
  if (!value) throw new PublishError("GitHub returned no OIDC token");
  return value;
}

export interface PublishOptions {
  directory?: string;
  /** bwx_ API token; when missing, GitHub OIDC is used. */
  token?: string | null;
  slug?: string;
  ref?: string;
  subpath?: string;
  dryRun?: boolean;
}

export async function submit(opts: PublishOptions): Promise<Submission> {
  const directory = (opts.directory || DEFAULT_DIRECTORY).replace(/\/+$/, "");
  let credential = opts.token || null;
  if (!credential) credential = await githubOidcToken(new URL(directory).origin);
  if (!credential) throw new PublishError("No credentials: set BULWARK_EXTENSIONS_TOKEN, or run in GitHub Actions with id-token: write and a trusted publisher set up.");
  const body: Record<string, string> = {};
  if (opts.slug) body.slug = opts.slug;
  if (opts.ref) body.ref = opts.ref;
  if (opts.subpath !== undefined && opts.subpath !== "") body.subpath = opts.subpath;
  return call<Submission>(`${directory}/api/v2/publish${opts.dryRun ? "/dry-run" : ""}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}` },
    body: JSON.stringify(body),
  });
}

export async function status(statusUrl: string, credential: string): Promise<Submission> {
  return call<Submission>(statusUrl, { headers: { Authorization: `Bearer ${credential}` } });
}

/** Poll until the build and checks are done (or the time is up). */
export async function waitFor(sub: Submission, credential: string, opts: { timeoutMs?: number; onUpdate?: (s: Submission) => void } = {}): Promise<Submission> {
  const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60_000);
  let current = sub;
  let delay = 3000;
  while (!SETTLED.has(current.status)) {
    if (Date.now() > deadline) throw new PublishError(`Still ${current.status} after waiting; follow it at ${current.url}`);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 30_000);
    current = await status(current.statusUrl, credential);
    opts.onUpdate?.(current);
  }
  return current;
}

export function describe(s: Submission): string {
  const lines = [`${s.slug} ${s.version ?? ""}: ${s.status.replace(/_/g, " ")}${s.dryRun ? " (dry run)" : ""}`, `  ${s.url}`];
  if (s.source?.commit) lines.push(`  built from ${s.source.repo}@${s.source.commit.slice(0, 12)}${s.source.subpath ? ` (${s.source.subpath})` : ""}`);
  if (s.error) lines.push(...s.error.split("\n").map((l) => `  ! ${l}`));
  for (const e of s.checks?.webmail?.errors ?? []) lines.push(`  ! webmail would refuse it: ${e}`);
  for (const f of s.checks?.scan?.findings ?? []) lines.push(`  ${f.severity === "block" ? "!" : "-"} ${f.rule}: ${f.message}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""}`);
  return lines.join("\n");
}
