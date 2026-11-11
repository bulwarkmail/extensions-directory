// Run: npx vitest run tests/session-secret.test.ts
//
// In production the session secret has to be the installation's own. The values that were
// ever published with the code (the development keys in the source, and the values
// .env.example carried) are known to everyone, so the app treats them like a missing
// secret: it does not start, and it neither opens nor issues a session with them. A value
// that is obviously not random (few different characters, one block repeated) is refused
// the same way. Outside production the app keeps working without a secret.
import crypto from "crypto";
import { sealData } from "iron-session";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stubSecrets } from "./helpers/secrets";

const DEV_KEY = "complex_password_at_least_32_characters_long_for_dev";
const PUBLISHED: [string, string][] = [
  ["the development key from the source", DEV_KEY],
  ["the value .env.example carried", "change-me-author-session-secret-min-32-chars!!"],
  ["the old admin development key", "complex_admin_password_at_least_32_chars_for_dev"],
  ["the old admin value from .env.example", "change-me-admin-session-secret-min-32-chars!!!"],
];
const jar = () => (globalThis as { __cookieJar?: Map<string, string> }).__cookieJar!;

beforeAll(async () => {
  const { db } = await import("@/lib/db/client");
  const schema = await import("@/lib/db/schema");
  await db.insert(schema.authors).values({ id: "boss", githubId: 6001, githubLogin: "boss", displayName: "Boss", role: "super_admin" });
});

// A production server also needs its token pepper and address-hash salt. Every test
// starts with fresh ones and sets the session secret it is about.
beforeEach(() => {
  stubSecrets({ AUTHOR_SESSION_SECRET: "" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  jar().clear();
});

/** The error the start fails with, or null when the server would come up. */
async function startError(): Promise<Error | null> {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  try {
    const { register } = await import("@/instrumentation");
    await register();
    return null;
  } catch (e) {
    return e as Error;
  }
}

const startRefused = async () => (await startError()) !== null;

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

/** Whether the session code hands out a cookie. */
async function issues(): Promise<boolean> {
  try {
    const { getSession } = await import("@/lib/auth/session");
    const session = await getSession();
    session.authorId = "boss";
    await session.save();
    return jar().has("ext_author_session");
  } catch {
    return false;
  }
}

const seal = (password: string) => sealData({ authorId: "boss", epoch: 0 }, { password, ttl: 3600 });

function production(secret: string): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTHOR_SESSION_SECRET", secret);
  vi.resetModules();
}

describe("a published value as the production session secret", () => {
  it.each(PUBLISHED)("%s: the server refuses to start", async (_name, secret) => {
    production(secret);
    expect(await startRefused()).toBe(true);
  });

  it.each(PUBLISHED)("%s: a cookie sealed with it is no session", async (_name, secret) => {
    production(secret);
    expect(await whoIs(await seal(secret))).toBe(null);
  });

  it.each(PUBLISHED)("%s: no session is issued with it", async (_name, secret) => {
    production(secret);
    expect(await issues()).toBe(false);
  });

  it.each(PUBLISHED)("%s with spaces around it is refused too", async (_name, secret) => {
    production(`  ${secret} `);
    expect(await startRefused()).toBe(true);
  });

  it.each(PUBLISHED)("%s in upper case is refused too", async (_name, secret) => {
    production(secret.toUpperCase());
    expect(await startRefused()).toBe(true);
    expect(await whoIs(await seal(secret.toUpperCase()))).toBe(null);
  });

  it.each(PUBLISHED)("%s with a trailing newline, as a secrets file has it, is refused too", async (_name, secret) => {
    production(`${secret}\n`);
    expect(await startRefused()).toBe(true);
    expect(await whoIs(await seal(`${secret}\n`))).toBe(null);
  });

  it("the start error says what is wrong and how to fix it, without the value", async () => {
    production(DEV_KEY);
    const error = await startError();
    expect(error?.message).toContain("AUTHOR_SESSION_SECRET");
    expect(error?.message).toContain("openssl rand -hex 32");
    expect(error?.message).not.toContain(DEV_KEY);
  });

  it("an own secret of the same length works (control)", async () => {
    // 46 characters, as long as the old example value.
    const secret = crypto.randomBytes(23).toString("hex");
    production(secret);
    expect(await startRefused()).toBe(false);
    expect(await whoIs(await seal(secret))).toBe("boss");
  });

  it.each(PUBLISHED)("%s still works outside production (control)", async (_name, secret) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTHOR_SESSION_SECRET", secret);
    vi.resetModules();
    expect(await startRefused()).toBe(false);
    expect(await whoIs(await seal(secret))).toBe("boss");
  });
});

describe("a production session secret that is obviously not random", () => {
  const NOT_RANDOM: [string, string][] = [
    ["one character 64 times", "a".repeat(64)],
    ["one digit 64 times", "0".repeat(64)],
    ["one block repeated", "0123456789abcdef".repeat(4)],
    ["one word repeated past the end", "my-secret-".repeat(4).slice(0, 36)],
    ["two characters taking turns", "ab".repeat(20)],
    ["seven different characters", "aaaabbbbccccddddeeeeffffgggggggg"],
  ];

  it.each(NOT_RANDOM)("%s: the server refuses to start and no session is opened or issued", async (_name, secret) => {
    production(secret);
    expect(await startRefused()).toBe(true);
    expect(await whoIs(await seal(secret))).toBe(null);
    expect(await issues()).toBe(false);
  });

  it("the start error names the problem without the value", async () => {
    const secret = "0123456789abcdef".repeat(4);
    production(secret);
    const error = await startError();
    expect(error?.message).toContain("AUTHOR_SESSION_SECRET");
    expect(error?.message).toContain("openssl rand -hex 32");
    expect(error?.message).not.toContain(secret);
  });
});

describe("generated secrets pass (control)", () => {
  // What `openssl rand -hex 32`, `openssl rand -hex 16` and `openssl rand -base64 32` print.
  const GENERATORS: [string, () => string][] = [
    ["32 random bytes as hex", () => crypto.randomBytes(32).toString("hex")],
    ["16 random bytes as hex", () => crypto.randomBytes(16).toString("hex")],
    ["32 random bytes as base64", () => crypto.randomBytes(32).toString("base64")],
  ];

  it.each(GENERATORS)("%s: the server starts and the session works", async (_name, make) => {
    const secret = make();
    production(`${secret}\n`);
    expect(await startRefused()).toBe(false);
    expect(await whoIs(await seal(`${secret}\n`))).toBe("boss");
  });

  it.each(GENERATORS)("%s: 2,000 fresh values are all accepted", async (_name, make) => {
    vi.stubEnv("NODE_ENV", "production");
    const { sessionSecret } = await import("@/lib/auth/session");
    for (let i = 0; i < 2000; i++) {
      const secret = make();
      vi.stubEnv("AUTHOR_SESSION_SECRET", secret);
      expect(sessionSecret()).toBe(secret);
    }
  });
});

describe("which NODE_ENV falls back to the development key", () => {
  const STRICT: [string, string | undefined][] = [["unset", undefined], ["production", "production"], ["staging", "staging"]];

  it.each(STRICT)("NODE_ENV %s, no secret: the server refuses to start and no session is opened or issued", async (_name, env) => {
    vi.stubEnv("NODE_ENV", env);
    vi.stubEnv("AUTHOR_SESSION_SECRET", "");
    vi.resetModules();
    expect(await startRefused()).toBe(true);
    expect(await whoIs(await seal(DEV_KEY))).toBe(null);
    expect(await issues()).toBe(false);
  });

  it.each(STRICT)("NODE_ENV %s, a blank secret: a cookie sealed with the development key is no session", async (_name, env) => {
    vi.stubEnv("NODE_ENV", env);
    vi.stubEnv("AUTHOR_SESSION_SECRET", "   \n");
    vi.resetModules();
    expect(await startRefused()).toBe(true);
    expect(await whoIs(await seal(DEV_KEY))).toBe(null);
  });

  it.each(STRICT)("NODE_ENV %s, the development key set as the secret: refused", async (_name, env) => {
    vi.stubEnv("NODE_ENV", env);
    vi.stubEnv("AUTHOR_SESSION_SECRET", DEV_KEY);
    vi.resetModules();
    expect(await startRefused()).toBe(true);
    expect(await whoIs(await seal(DEV_KEY))).toBe(null);
  });

  it.each([["test", "test"], ["development", "development"]])("NODE_ENV %s, no secret: the app works with the development key (control)", async (_name, env) => {
    vi.stubEnv("NODE_ENV", env);
    vi.stubEnv("AUTHOR_SESSION_SECRET", "");
    vi.resetModules();
    expect(await startRefused()).toBe(false);
    expect(await whoIs(await seal(DEV_KEY))).toBe("boss");
    jar().clear();
    expect(await issues()).toBe(true);
  });
});
