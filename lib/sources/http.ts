// HTTP for source hosts. URLs are only ever built from the fixed host list
// below, redirects are followed by hand and only to hosts on that list, and
// every body is read with a size cap, so a repository can't point the
// directory at an internal address or make it read an endless response.

const ALLOWED_HOSTS = new Set([
  "api.github.com",
  "codeload.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "gitlab.com",
  "codeberg.org",
]);

export class SourceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface FetchOptions {
  headers?: Record<string, string>;
  maxBytes: number;
  timeoutMs?: number;
}

let fetchImpl: typeof fetch = (...args) => fetch(...args);
/** Tests swap the network out here. */
export function setFetch(f: typeof fetch): void {
  fetchImpl = f;
}

function checkHost(url: URL): void {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.port || url.username || url.password) {
    throw new SourceError(`Refusing to fetch ${url.origin}`);
  }
}

/** GET a URL on an allowed host. Returns null on 404. */
export async function get(rawUrl: string, opts: FetchOptions): Promise<Buffer | null> {
  let url = new URL(rawUrl);
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  for (let hop = 0; hop < 4; hop++) {
    checkHost(url);
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "bulwarkmail-extension-directory", ...opts.headers },
      redirect: "manual",
      signal: deadline,
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      // Credentials stay with the API host; the redirect target is a CDN.
      opts = { ...opts, headers: Object.fromEntries(Object.entries(opts.headers ?? {}).filter(([k]) => k.toLowerCase() !== "authorization" && k.toLowerCase() !== "private-token")) };
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new SourceError(`${url.hostname} answered ${res.status} for ${url.pathname}`, res.status);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > opts.maxBytes) throw new SourceError(`Response from ${url.hostname} is larger than ${opts.maxBytes} bytes`);
    return readCapped(res, opts.maxBytes, url.hostname);
  }
  throw new SourceError("Too many redirects");
}

async function readCapped(res: Response, max: number, host: string): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new SourceError(`Response from ${host} is larger than ${max} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function getJson<T>(url: string, opts: Omit<FetchOptions, "maxBytes"> & { maxBytes?: number } = {}): Promise<T | null> {
  const body = await get(url, { maxBytes: 2 * 1024 * 1024, ...opts, headers: { Accept: "application/json", ...opts.headers } });
  if (body === null) return null;
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw new SourceError(`Invalid JSON from ${new URL(url).hostname}`);
  }
}
