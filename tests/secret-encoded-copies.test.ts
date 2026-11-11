// Run: npx vitest run tests/secret-encoded-copies.test.ts
//
// A published value run through base64, hex, base32 or a hash command is as public as the
// value itself, so lib/auth/secrets.ts refuses it for all three keys:
//   - a value that is hex, base64, base64url or base32 of text gets the same check on the
//     decoded text (also when it was encoded twice), and
//   - a value that is the MD5, SHA-1, SHA-256, SHA-384 or SHA-512 of a published value
//     (as hex or base64, of the value as written or in upper case, with or without a line
//     end) is refused like the value itself.
// Generated secrets are hex or base64 of random bytes, which decode to no text, so the
// controls at the end stay accepted.
import crypto from "crypto";
import { sealData, unsealData } from "iron-session";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { freshSecret, stubSecrets, type SecretKey } from "./helpers/secrets";

const DEV_KEY = "complex_password_at_least_32_characters_long_for_dev";
const EXAMPLE = "change-me-author-session-secret-min-32-chars!!";
const PLACEHOLDER = "change-me-random-hex";
// Every value lib/auth/secrets.ts lists as published.
const PUBLISHED = [
  EXAMPLE,
  DEV_KEY,
  "change-me-admin-session-secret-min-32-chars!!!",
  "complex_admin_password_at_least_32_chars_for_dev",
  PLACEHOLDER,
  "dev-token-pepper",
  "extdir",
  "http-test-session-secret-0123456789abcdef",
  "a-real-secret-of-more-than-32-characters-0123",
  "http-test-pepper",
  "a-salt-for-the-test",
  "short-secret-0123456789",
  "0123456789abcdef".repeat(4),
  "my-secret-".repeat(4).slice(0, 36),
  "aaaabbbbccccddddeeeeffffgggggggg",
  "aabbccddeeffaabbccddeeffaabbccdde0",
];
const jar = () => (globalThis as { __cookieJar?: Map<string, string> }).__cookieJar!;

const base64 = (text: string) => Buffer.from(text).toString("base64");
const base64url = (text: string) => Buffer.from(text).toString("base64url");
const hex = (text: string) => Buffer.from(text).toString("hex");
const digest = (name: string, text: string, form: "hex" | "base64" = "hex") => crypto.createHash(name).update(text).digest(form);
function base32(text: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of Buffer.from(text)) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  while (out.length % 8) out += "=";
  return out;
}

beforeAll(async () => {
  const { db } = await import("@/lib/db/client");
  const schema = await import("@/lib/db/schema");
  await db.insert(schema.authors).values({ id: "boss", githubId: 6001, githubLogin: "boss", displayName: "Boss", role: "super_admin" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  jar().clear();
});

/** A production server with its own three keys, except the ones given. */
function production(given: Partial<Record<SecretKey, string>> = {}): void {
  vi.stubEnv("NODE_ENV", "production");
  stubSecrets(given);
  vi.resetModules();
}

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

const seal = (password: string) => sealData({ authorId: "boss", epoch: 0 }, { password, ttl: 3600 });

/** What the production check says about a value for a key: the error's text, or null. */
async function judge(key: SecretKey = "AUTHOR_SESSION_SECRET"): Promise<(value: string) => string | null> {
  vi.stubEnv("NODE_ENV", "production");
  const { secretProblem } = await import("@/lib/auth/secrets");
  return (value) => {
    vi.stubEnv(key, value);
    return secretProblem(key);
  };
}

// All of these have 32 characters or more, so none is refused for its length.
const ENCODED_SESSION: [string, string][] = [
  ["base64 of the old example value", base64(EXAMPLE)],
  ["base64 of the old example value with the line end echo adds", base64(`${EXAMPLE}\n`)],
  ["base64 of the old example value without its padding, in quotes", `"${base64(`${EXAMPLE}\n`).replace(/=+$/, "")}"`],
  ["base64url of the old example value", base64url(EXAMPLE)],
  ["hex of the old example value", hex(EXAMPLE)],
  ["hex of the old example value in upper case", hex(EXAMPLE).toUpperCase()],
  ["base32 of the old example value", base32(EXAMPLE)],
  ["base64 of the old example value written in upper case", base64(EXAMPLE.toUpperCase())],
  ["base64 of the base64 of the old example value", base64(base64(EXAMPLE))],
  ["base64 of the development key", base64(DEV_KEY)],
  ["hex of the old admin example value", hex(PUBLISHED[2])],
  ["base64 of the old example value with 1 added", base64(`${EXAMPLE}1`)],
  ["base64 of a value an earlier test used", base64(PUBLISHED[8])],
];

const HASHED_SESSION: [string, string][] = [
  ["SHA-256 of the old example value, as sha256sum prints it", digest("sha256", EXAMPLE)],
  ["SHA-256 of the old example value with the line end echo adds", digest("sha256", `${EXAMPLE}\n`)],
  ["SHA-256 of the old example value as base64", digest("sha256", EXAMPLE, "base64")],
  ["MD5 of the old example value", digest("md5", `${EXAMPLE}\n`)],
  ["SHA-1 of the development key", digest("sha1", DEV_KEY)],
  ["SHA-512 of the old example value", digest("sha512", EXAMPLE)],
  ["SHA-256 of the old example value in upper case", digest("sha256", EXAMPLE).toUpperCase()],
];

describe.each([
  ["encoded", ENCODED_SESSION],
  ["hashed", HASHED_SESSION],
])("a published value, %s, as the production session secret", (_kind, cases) => {
  it.each(cases)("%s: the server refuses to start", async (_name, secret) => {
    production({ AUTHOR_SESSION_SECRET: secret });
    const error = await startError();
    expect(error).not.toBe(null);
    expect(error!.message).toContain("AUTHOR_SESSION_SECRET is a value published with the source code, or close to one");
  });

  it.each(cases)("%s: a cookie sealed with it is no session", async (_name, secret) => {
    production({ AUTHOR_SESSION_SECRET: secret });
    expect(await whoIs(await seal(secret))).toBe(null);
  });
});

describe("every published value in every usual encoding and digest", () => {
  // The value as written, in upper case, with and without the line end a shell adds.
  const texts = (p: string) => [...new Set([p, p.toUpperCase()])].flatMap((t) => [t, `${t}\n`, `${t}\r\n`]);
  const encodings = (p: string) => texts(p).flatMap((t) => [base64(t), base64(t).replace(/=+$/, ""), base64url(t), hex(t), hex(t).toUpperCase(), base32(t), base32(t).toLowerCase(), base64(base64(t))]);
  const digests = (p: string) => texts(p).flatMap((t) => ["md5", "sha1", "sha256", "sha384", "sha512"].flatMap((h) => [digest(h, t), digest(h, t).toUpperCase(), digest(h, t, "base64"), crypto.createHash(h).update(t).digest("base64url")]));

  it("none of the encodings is accepted for any of the three keys", async () => {
    for (const key of ["AUTHOR_SESSION_SECRET", "TOKEN_PEPPER", "IP_HASH_SALT"] as const) {
      const problem = await judge(key);
      const accepted = [...new Set(PUBLISHED.flatMap(encodings))].filter((v) => problem(v) === null);
      expect(accepted.length).toBe(0);
    }
  });

  it("none of the digests is accepted for any of the three keys", async () => {
    for (const key of ["AUTHOR_SESSION_SECRET", "TOKEN_PEPPER", "IP_HASH_SALT"] as const) {
      const problem = await judge(key);
      const accepted = [...new Set(PUBLISHED.flatMap(digests))].filter((v) => problem(v) === null);
      expect(accepted.length).toBe(0);
    }
  });

  it.each([
    ["base64 of the old example value with its line end", base64(`${EXAMPLE}\n`)],
    ["hex of the development key", hex(DEV_KEY)],
    ["SHA-256 of the old example value", digest("sha256", EXAMPLE)],
  ])("%s: the cookie of a sign-in that was only started gives nothing away", async (_name, secret) => {
    production({ AUTHOR_SESSION_SECRET: secret });
    // What GET /api/v1/auth/github does for anyone: it stores the OAuth state in the session cookie.
    let cookie: string | undefined;
    try {
      const { getSession } = await import("@/lib/auth/session");
      const session = await getSession();
      session.oauthState = crypto.randomBytes(16).toString("hex");
      await session.save();
      cookie = jar().get("ext_author_session");
    } catch {
      cookie = undefined;
    }
    // No cookie is issued, so no candidate can open one or lead to a session.
    let found: string | null = null;
    let tried = 0;
    if (cookie) {
      for (const candidate of new Set(PUBLISHED.flatMap((p) => [...encodings(p), ...digests(p)]).filter((v) => v.length >= 32))) {
        tried++;
        const data = await unsealData<{ oauthState?: string }>(cookie, { password: candidate, ttl: 14 * 24 * 3600 }).catch(() => ({} as { oauthState?: string }));
        if (data.oauthState) { found = candidate; break; }
      }
    }
    const signedInAs = found ? await whoIs(await seal(found)) : null;
    expect({ cookieIssued: Boolean(cookie), secretFound: found !== null, tried, signedInAs }).toEqual({ cookieIssued: false, secretFound: false, tried: 0, signedInAs: null });
  }, 60_000);
});

describe.each(["TOKEN_PEPPER", "IP_HASH_SALT"] as const)("a published value, encoded or hashed, as %s in production", (key) => {
  const CASES: [string, string][] = [
    ["hex of the placeholder of .env.example", hex(PLACEHOLDER)],
    ["hex of the placeholder with its line end", hex(`${PLACEHOLDER}\n`)],
    ["SHA-256 of the placeholder", digest("sha256", PLACEHOLDER)],
    ["SHA-256 of the placeholder with its line end", digest("sha256", `${PLACEHOLDER}\n`)],
    ["MD5 of the placeholder", digest("md5", PLACEHOLDER)],
    ["base64 of the old example value of the session secret", base64(EXAMPLE)],
    ["base64 of the placeholder twice", base64(PLACEHOLDER + PLACEHOLDER)],
  ];

  it.each(CASES)("%s: the server refuses to start and names this key", async (_name, value) => {
    production({ [key]: value });
    const error = await startError();
    expect(error).not.toBe(null);
    expect(error!.message).toContain(`${key} is a value published with the source code, or close to one`);
  });

  it.each(CASES)("%s: nothing is hashed with it", async (_name, value) => {
    production({ [key]: value });
    let hashed: string | null;
    try {
      hashed = key === "TOKEN_PEPPER" ? (await import("@/lib/auth/tokens")).hashToken("bwx_example") : (await import("@/lib/audit")).hashIp("203.0.113.7");
    } catch {
      hashed = null;
    }
    expect(hashed).toBe(null);
  });
});

describe("an encoding or a digest as a command prints it, and one inside another", () => {
  const KEYS = ["AUTHOR_SESSION_SECRET", "TOKEN_PEPPER", "IP_HASH_SALT"] as const;
  const inLines = (text: string) => text.replace(/(.{64})/g, "$1\n");
  const CASES: [string, string][] = [
    ["SHA-256 of the old example value with the file name sha256sum adds", `${digest("sha256", `${EXAMPLE}\n`)}  -`],
    ["SHA-256 of the old example value with the hash's name in front", `sha256:${digest("sha256", EXAMPLE)}`],
    ["SHA-512 of the placeholder as base64", digest("sha512", PLACEHOLDER, "base64")],
    ["base64 of the line sha256sum prints for the old example value", base64(`${digest("sha256", `${EXAMPLE}\n`)}  -\n`)],
    ["base64 of the development key in lines of 64 characters", inLines(base64(DEV_KEY))],
    ["hex of the base64 of the old example value", hex(base64(EXAMPLE))],
    ["base32 of the hex of the placeholder", base32(hex(PLACEHOLDER))],
    ["base64 of the old example value with its last character changed and 1 added", base64(`${EXAMPLE.slice(0, -1)}?1`)],
    ["base64 of the old example value written backwards", base64([...EXAMPLE].reverse().join(""))],
  ];

  it.each(CASES)("%s is refused as published for each of the three keys", async (_name, value) => {
    for (const key of KEYS) expect((await judge(key))(value)).toContain(`${key} is a value published with the source code, or close to one`);
  });

  it("base64 of text with six different characters is refused as not random for each of the three keys", async () => {
    const text = Array.from({ length: 40 }, () => "qwertz"[crypto.randomInt(6)]).join("");
    for (const key of KEYS) expect((await judge(key))(base64(text))).toContain(`${key} does not look random`);
  });
});

// ---------------------------------------------------------------------------
// Controls: what must stay accepted, and what was refused before and still is.
// ---------------------------------------------------------------------------

describe("secrets an operator makes stay accepted (control)", () => {
  const PASSWORD_CHARS = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i));
  const GENERATORS: [string, () => string][] = [
    ["32 random bytes as hex (openssl rand -hex 32)", () => crypto.randomBytes(32).toString("hex")],
    ["32 random bytes as hex in upper case", () => crypto.randomBytes(32).toString("hex").toUpperCase()],
    ["32 random bytes as base64 (openssl rand -base64 32)", () => crypto.randomBytes(32).toString("base64")],
    ["32 random bytes as base64url", () => crypto.randomBytes(32).toString("base64url")],
    ["48 random bytes as base64", () => crypto.randomBytes(48).toString("base64")],
    ["a random UUID", () => crypto.randomUUID()],
    ["a password manager's 40 characters", () => Array.from({ length: 40 }, () => PASSWORD_CHARS[crypto.randomInt(94)]).join("")],
    // Text that is itself hex or base64 of text: the decoded text is random too.
    ["base64 of a fresh hex secret with its line end (openssl rand -hex 32 | base64)", () => base64(`${freshSecret()}\n`)],
    ["hex of a fresh base64 secret", () => hex(crypto.randomBytes(32).toString("base64"))],
    ["SHA-256 of 32 random bytes", () => crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex")],
  ];

  it.each(GENERATORS)("%s: 20,000 fresh values are all accepted", async (_name, make) => {
    const problem = await judge();
    let refused = 0;
    for (let i = 0; i < 20_000; i++) if (problem(make()) !== null) refused++;
    expect(refused).toBe(0);
  }, 120_000);

  it("a generated secret starts the server and opens its own sessions", async () => {
    const secret = freshSecret();
    production({ AUTHOR_SESSION_SECRET: secret });
    expect(await startError()).toBe(null);
    expect(await whoIs(await seal(secret))).toBe("boss");
  });

  it.each(["test", "development"])("NODE_ENV %s: an encoded published value still works", async (env) => {
    vi.stubEnv("NODE_ENV", env);
    stubSecrets({ AUTHOR_SESSION_SECRET: base64(EXAMPLE) });
    vi.resetModules();
    expect(await startError()).toBe(null);
    expect(await whoIs(await seal(base64(EXAMPLE)))).toBe("boss");
  });
});

describe("exact and near copies stay refused (control)", () => {
  it.each([
    ["the old example value", EXAMPLE],
    ["the old example value with the year added", `${EXAMPLE}2026`],
    ["the old example value with the project's name in front", `bulwark-${EXAMPLE}`],
    ["the old example value in upper case with underscores", EXAMPLE.toUpperCase().replaceAll("-", "_")],
    ["the old example value in upper case without separators", EXAMPLE.toUpperCase().replace(/[^A-Z0-9]/g, "")],
  ])("%s: the server refuses to start", async (_name, secret) => {
    production({ AUTHOR_SESSION_SECRET: secret });
    expect((await startError())?.message).toContain("published with the source code, or close to one");
  });
});
