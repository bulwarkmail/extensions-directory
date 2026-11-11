// Run: npx vitest run tests/fail-closed-config.test.ts
//
// In production the app opens and issues sessions only with its own AUTHOR_SESSION_SECRET,
// so a cookie sealed with the development key from the source code is no session there;
// and without NEXT_PUBLIC_SITE_URL the same-origin check for writes compares with the
// request's own origin instead of being skipped.
//
// The first tests pass when the app refuses to start (instrumentation.ts `register`
// throws) or when the session code refuses to open or save a session. The tests further
// down check each of the two on its own.
import { sealData } from "iron-session";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshSecret, stubSecrets } from "./helpers/secrets";

// The key the session code falls back to outside production.
const SOURCE_CONSTANT = "complex_password_at_least_32_characters_long_for_dev";
const jar = () => (globalThis as { __cookieJar?: Map<string, string> }).__cookieJar!;

beforeAll(async () => {
  const { db } = await import("@/lib/db/client");
  const schema = await import("@/lib/db/schema");
  await db.insert(schema.authors).values({ id: "boss", githubId: 6001, githubLogin: "boss", displayName: "Boss", role: "super_admin" });
});

// A production server also needs its token pepper and address-hash salt. Every test
// starts with fresh ones and sets what it is about.
beforeEach(() => {
  stubSecrets({ AUTHOR_SESSION_SECRET: "" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  jar().clear();
});

/** True when the app would not come up at all with the current environment. */
async function startRefused(): Promise<boolean> {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  try {
    const { register } = await import("@/instrumentation");
    await register();
    return false;
  } catch {
    return true;
  }
}

/** The account a request with this cookie is treated as, or null (also when the session code throws). */
async function whoIs(cookie: string): Promise<string | null> {
  jar().set("ext_author_session", cookie);
  try {
    const { currentUser } = await import("@/lib/auth/session");
    return (await currentUser())?.id ?? null;
  } catch {
    return null;
  }
}

describe("production settings that are missing", () => {
  it.each([["unset", ""], ["31 characters", "x".repeat(31)]])("AUTHOR_SESSION_SECRET %s: a cookie sealed with the source constant is no session", async (_name, secret) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTHOR_SESSION_SECRET", secret);
    vi.resetModules();
    const forged = await sealData({ authorId: "boss", epoch: 0 }, { password: SOURCE_CONSTANT, ttl: 3600 });
    const refusedAtStart = await startRefused();
    const account = await whoIs(forged);
    expect(refusedAtStart || account === null).toBe(true);
  });

  it("AUTHOR_SESSION_SECRET unset: no new session is issued either", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTHOR_SESSION_SECRET", "");
    vi.resetModules();
    const refusedAtStart = await startRefused();
    const issued = await (async () => {
      try {
        const { getSession } = await import("@/lib/auth/session");
        const session = await getSession();
        session.authorId = "boss";
        await session.save();
        return jar().has("ext_author_session");
      } catch {
        return false;
      }
    })();
    expect(refusedAtStart || !issued).toBe(true);
  });

  it("a real secret still works in production (control)", async () => {
    const secret = freshSecret();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTHOR_SESSION_SECRET", secret);
    vi.resetModules();
    expect(await startRefused()).toBe(false);
    expect(await whoIs(await sealData({ authorId: "boss", epoch: 0 }, { password: secret, ttl: 3600 }))).toBe("boss");
    expect(await whoIs(await sealData({ authorId: "boss", epoch: 0 }, { password: SOURCE_CONSTANT, ttl: 3600 }))).toBe(null);
  });

  it("development still runs without the secret (control)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTHOR_SESSION_SECRET", "");
    vi.resetModules();
    expect(await startRefused()).toBe(false);
    const { getSession } = await import("@/lib/auth/session");
    const session = await getSession();
    session.authorId = "boss";
    await expect(session.save()).resolves.toBeUndefined();
  });

  const write = (origin: string | null) =>
    new Request("https://extensions.test/api/v2/tokens", { method: "POST", headers: { host: "extensions.test", ...(origin ? { origin } : {}) } });

  it("NEXT_PUBLIC_SITE_URL unset: a cross-site write is refused", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.resetModules();
    const { assertSameOrigin } = await import("@/lib/auth/session");
    expect(() => assertSameOrigin(write("https://evil.example"))).toThrow();
    expect(() => assertSameOrigin(write("https://extensions.test.evil.example"))).toThrow();
    expect(() => assertSameOrigin(write("http://extensions.test"))).toThrow();
  });

  it("NEXT_PUBLIC_SITE_URL unset: a write without an Origin header is refused", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.resetModules();
    const { assertSameOrigin } = await import("@/lib/auth/session");
    expect(() => assertSameOrigin(write(null))).toThrow();
  });

  it("NEXT_PUBLIC_SITE_URL unset: a write from the app's own pages still passes (control)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.resetModules();
    const { assertSameOrigin } = await import("@/lib/auth/session");
    expect(() => assertSameOrigin(write("https://extensions.test"))).not.toThrow();
  });

  it("NEXT_PUBLIC_SITE_URL set: only that origin passes (control)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://extensions.test");
    vi.resetModules();
    const { assertSameOrigin } = await import("@/lib/auth/session");
    expect(() => assertSameOrigin(write("https://extensions.test"))).not.toThrow();
    expect(() => assertSameOrigin(write("https://evil.example"))).toThrow();
  });
});

const BAD_SECRETS: [string, string][] = [["unset", ""], ["31 characters", "x".repeat(31)], ["spaces only", " ".repeat(40)]];

describe("a production secret that is missing, short or blank, checked in each place", () => {
  it.each(BAD_SECRETS)("AUTHOR_SESSION_SECRET %s: the server refuses to start", async (_name, secret) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTHOR_SESSION_SECRET", secret);
    vi.resetModules();
    expect(await startRefused()).toBe(true);
  });

  it.each(BAD_SECRETS)("AUTHOR_SESSION_SECRET %s: the session code opens and issues no session", async (_name, secret) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTHOR_SESSION_SECRET", secret);
    vi.resetModules();
    expect(await whoIs(await sealData({ authorId: "boss", epoch: 0 }, { password: SOURCE_CONSTANT, ttl: 3600 }))).toBe(null);
    // A secret long enough for iron-session but blank seals cookies anyone can make.
    if (secret.length >= 32) expect(await whoIs(await sealData({ authorId: "boss", epoch: 0 }, { password: secret, ttl: 3600 }))).toBe(null);
    jar().clear();
    const issued = await (async () => {
      try {
        const { getSession } = await import("@/lib/auth/session");
        const session = await getSession();
        session.authorId = "boss";
        await session.save();
        return jar().has("ext_author_session");
      } catch {
        return false;
      }
    })();
    expect(issued).toBe(false);
  });
});

describe("the same-origin check for writes", () => {
  const write = (origin: string | null) =>
    new Request("https://extensions.test/api/v2/tokens", { method: "POST", headers: { host: "extensions.test", ...(origin ? { origin } : {}) } });

  it.each(["extensions.test", "not a url", "   ", "ftp://extensions.test"])("NEXT_PUBLIC_SITE_URL %j is no web address: every write is refused with 403", async (site) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
    vi.resetModules();
    const { assertSameOrigin } = await import("@/lib/auth/session");
    for (const origin of ["https://extensions.test", "http://extensions.test", null]) {
      let error: unknown = null;
      try {
        assertSameOrigin(write(origin));
      } catch (e) {
        error = e;
      }
      expect(error).toMatchObject({ status: 403, code: "bad_origin" });
    }
  });

  // Behind nginx the request URL carries the address Next listens on; the browser's
  // host arrives in the Host header and the scheme in X-Forwarded-Proto.
  const proxied = (host: string, origin: string | null) =>
    new Request("https://127.0.0.1:3004/api/v2/tokens", { method: "POST", headers: { host, ...(origin ? { origin } : {}) } });

  it("NEXT_PUBLIC_SITE_URL unset, behind a proxy: the Host header names the own origin, port included", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.resetModules();
    const { assertSameOrigin } = await import("@/lib/auth/session");
    expect(() => assertSameOrigin(proxied("extensions.test", "https://extensions.test"))).not.toThrow();
    expect(() => assertSameOrigin(proxied("extensions.test:8443", "https://extensions.test:8443"))).not.toThrow();
    expect(() => assertSameOrigin(proxied("extensions.test:8443", "https://extensions.test"))).toThrow();
    expect(() => assertSameOrigin(proxied("extensions.test", "https://extensions.test:8443"))).toThrow();
    expect(() => assertSameOrigin(proxied("extensions.test", "http://extensions.test"))).toThrow();
    expect(() => assertSameOrigin(proxied("extensions.test", "https://127.0.0.1:3004"))).toThrow();
    expect(() => assertSameOrigin(proxied("extensions.test", "null"))).toThrow();
    expect(() => assertSameOrigin(proxied("extensions.test", null))).toThrow();
  });
});

describe("the salt for IP hashes", () => {
  it("production without IP_HASH_SALT and without a session secret: nothing is hashed with the fixed salt", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IP_HASH_SALT", "");
    vi.stubEnv("AUTHOR_SESSION_SECRET", "");
    vi.resetModules();
    const { hashIp } = await import("@/lib/audit");
    expect(() => hashIp("192.0.2.1")).toThrow();
  });

  it("production with IP_HASH_SALT hashes (control)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IP_HASH_SALT", freshSecret());
    vi.resetModules();
    const { hashIp } = await import("@/lib/audit");
    expect(hashIp("192.0.2.1")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("development without either still hashes (control)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("IP_HASH_SALT", "");
    vi.stubEnv("AUTHOR_SESSION_SECRET", "");
    vi.resetModules();
    const { hashIp } = await import("@/lib/audit");
    expect(hashIp("192.0.2.1")).toMatch(/^[0-9a-f]{32}$/);
  });
});
