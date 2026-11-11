// Run: npx vitest run tests/pepper-and-salt.test.ts
//
// TOKEN_PEPPER keys the hashes of the stored API tokens, IP_HASH_SALT the hashes of the
// stored client addresses. In production each has to be the installation's own, under the
// same rule as the session secret (lib/auth/secrets.ts): set, at least 32 characters,
// random, and neither a value this repository ever held nor anything close to one.
// Without that the server does not start and nothing is hashed. Development and tests
// keep working without them.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshSecret, SECRET_KEYS, stubSecrets, type SecretKey } from "./helpers/secrets";
import { req } from "./helpers/http";

// What both lines of .env.example carried.
const PLACEHOLDER = "change-me-random-hex";
const KEYS = ["TOKEN_PEPPER", "IP_HASH_SALT"] as const;
const fill = (n: number) => crypto.randomBytes(n).toString("hex").slice(0, n);
const backwards = (text: string) => [...text].reverse().join("");

// The keys are read from the environment on every use, so the modules are loaded once.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A production server with its own three keys, except the ones given. */
function production(given: Partial<Record<SecretKey, string>> = {}): void {
  vi.stubEnv("NODE_ENV", "production");
  stubSecrets(given);
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

async function ipHash(): Promise<string | null> {
  const { hashIp } = await import("@/lib/audit");
  try {
    return hashIp("203.0.113.7");
  } catch {
    return null;
  }
}

async function tokenHash(): Promise<string | null> {
  const { hashToken } = await import("@/lib/auth/tokens");
  try {
    return hashToken("bwx_example");
  } catch {
    return null;
  }
}

const hashWith = { TOKEN_PEPPER: tokenHash, IP_HASH_SALT: ipHash };

// Values no production server may run with. Where one is shorter than 32 characters it
// is filled up, so that the length is not what refuses it.
const REFUSED: [string, string][] = [
  ["unset", ""],
  ["blank", "   "],
  ["31 characters", fill(31)],
  ["the placeholder of .env.example", PLACEHOLDER],
  ["the placeholder with spaces and a line end", ` ${PLACEHOLDER}\n`],
  ["the placeholder in upper case", PLACEHOLDER.toUpperCase()],
  ["the placeholder filled up with random digits", PLACEHOLDER + fill(12)],
  ["the placeholder with a label added, in quotes", `"${PLACEHOLDER}-for-production-2026"`],
  ["the placeholder behind random digits, in upper case", (fill(16) + PLACEHOLDER).toUpperCase()],
  ["the placeholder with one character changed in its middle, filled up", `change-me_random-hex${fill(16)}`],
  ["the placeholder with underscores for its hyphens, filled up", PLACEHOLDER.replaceAll("-", "_") + fill(16)],
  ["the placeholder without its hyphens, filled up", fill(8) + PLACEHOLDER.replaceAll("-", "") + fill(8)],
  ["the placeholder written backwards, filled up", backwards(PLACEHOLDER) + fill(16)],
  ["the placeholder twice", PLACEHOLDER + PLACEHOLDER],
  ["the development pepper of the source, filled up", `dev-token-pepper${fill(16)}`],
  ["the development salt of the source, repeated to length", "extdir".repeat(6)],
  ["the pepper an earlier test used, filled up", `http-test-pepper-${fill(16)}`],
  ["the salt an earlier test used, filled up", `${fill(16)}a-salt-for-the-test`],
  ["the old example value of the session secret", "change-me-author-session-secret-min-32-chars!!"],
  ["the development key of the session secret with 1 added", "complex_password_at_least_32_characters_long_for_dev1"],
  ["one random block repeated", fill(8).repeat(4)],
  ["seven different characters", "abcdefg".repeat(5).split("").sort(() => crypto.randomInt(3) - 1).join("")],
];

describe.each(KEYS)("%s in production", (key) => {
  it.each(REFUSED)("%s: the server refuses to start and names this key, never the value", async (_name, value) => {
    production({ [key]: value });
    const error = await startError();
    expect(error).not.toBe(null);
    expect(error!.message).toContain(key);
    expect(error!.message).toContain("openssl rand -hex 32");
    for (const other of SECRET_KEYS) if (other !== key) expect(error!.message).not.toContain(other);
    const text = `${error!.message}\n${error!.stack}\n${JSON.stringify(error, Object.getOwnPropertyNames(error))}`.toLowerCase();
    if (value.trim()) expect(text).not.toContain(value.trim().toLowerCase().slice(0, 16));
    expect(text).not.toContain(PLACEHOLDER);
  });

  it.each(REFUSED)("%s: nothing is hashed with it", async (_name, value) => {
    production({ [key]: value });
    expect(await hashWith[key]()).toBe(null);
  });

  it("a value of its own starts the server and keys the hash exactly as given", async () => {
    const own = `${freshSecret()}\n`;
    production({ [key]: own });
    expect(await startError()).toBe(null);
    const expected = key === "TOKEN_PEPPER"
      ? crypto.createHmac("sha256", own).update("bwx_example").digest("hex")
      : crypto.createHmac("sha256", own).update("203.0.113.7").digest("hex").slice(0, 32);
    expect(await hashWith[key]()).toBe(expected);
  });

  const PASSWORD_CHARS = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i));
  const GENERATORS: [string, () => string][] = [
    ["32 random bytes as hex (openssl rand -hex 32)", () => crypto.randomBytes(32).toString("hex")],
    ["32 random bytes as base64 (openssl rand -base64 32)", () => crypto.randomBytes(32).toString("base64")],
    ["a random UUID", () => crypto.randomUUID()],
    ["a password manager's 40 characters", () => Array.from({ length: 40 }, () => PASSWORD_CHARS[crypto.randomInt(94)]).join("")],
  ];

  it.each(GENERATORS)("%s: 10,000 fresh values are all accepted (control)", async (_name, make) => {
    vi.stubEnv("NODE_ENV", "production");
    const { secretProblem } = await import("@/lib/auth/secrets");
    const refused: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const value = make();
      vi.stubEnv(key, value);
      if (secretProblem(key) !== null) refused.push(value);
    }
    expect(refused).toEqual([]);
  }, 60_000);

  it.each(["test", "development"])("NODE_ENV %s: the placeholder, a blank value and no value all still hash (control)", async (env) => {
    for (const value of [PLACEHOLDER, "   ", ""]) {
      vi.stubEnv("NODE_ENV", env);
      stubSecrets({ [key]: value });
      expect(await startError()).toBe(null);
      expect(await hashWith[key]()).toMatch(/^[0-9a-f]{32,64}$/);
    }
  });
});

describe("the three keys together", () => {
  it("own values for all three: the server starts and both hashes come out", async () => {
    production();
    expect(await startError()).toBe(null);
    expect(await ipHash()).toMatch(/^[0-9a-f]{32}$/);
    expect(await tokenHash()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the start error names every key that is wrong, each with the way to make one", async () => {
    production({ AUTHOR_SESSION_SECRET: "", TOKEN_PEPPER: PLACEHOLDER + fill(12), IP_HASH_SALT: fill(8).repeat(4) });
    const message = (await startError())!.message;
    expect(message.split("\n")).toEqual([
      "AUTHOR_SESSION_SECRET must be set to at least 32 characters. Generate one with: openssl rand -hex 32",
      "TOKEN_PEPPER is a value published with the source code, or close to one. Generate one with: openssl rand -hex 32",
      "IP_HASH_SALT does not look random. Generate one with: openssl rand -hex 32",
    ]);
  });

  it("an address is not hashed with the session secret when IP_HASH_SALT is missing", async () => {
    const session = freshSecret();
    production({ AUTHOR_SESSION_SECRET: session, IP_HASH_SALT: "" });
    expect(await ipHash()).toBe(null);
    expect((await startError())!.message).toMatch(/^IP_HASH_SALT must be set/);
  });

  it("a value is judged the same whichever key it is set for", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { secretProblem } = await import("@/lib/auth/secrets");
    const values = [...REFUSED.map(([, value]) => value), ...Array.from({ length: 200 }, freshSecret)];
    for (const value of values) {
      const verdicts = SECRET_KEYS.map((key) => {
        vi.stubEnv(key, value);
        return secretProblem(key)?.replace(key, "") ?? null;
      });
      expect(new Set(verdicts).size).toBe(1);
    }
  });

  // The API router hashes the caller's address for every request.
  const ping = async () => {
    const { router } = await import("@/lib/api/router");
    const { ok } = await import("@/lib/http");
    return router([{ method: "GET", path: "/ping", auth: null, handler: async () => ok("pong") }])("GET")(req("/api/v2/ping"));
  };

  it("an API request on a server with the placeholder as salt answers 500 without the reason", async () => {
    production({ IP_HASH_SALT: PLACEHOLDER + fill(12) });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await ping();
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("IP_HASH_SALT");
    expect(body).not.toContain(PLACEHOLDER);
    // The server log has the reason, again without the value.
    const log = logged.mock.calls.flat().map((part) => (part instanceof Error ? `${part.message}\n${part.stack}` : String(part))).join("\n");
    expect(log).toContain("IP_HASH_SALT is a value published with the source code, or close to one");
    expect(log.toLowerCase()).not.toContain(PLACEHOLDER);
  });

  it("the same request with own keys answers 200 (control)", async () => {
    production();
    expect((await ping()).status).toBe(200);
  });
});

describe(".env.example", () => {
  const example = fs.readFileSync(path.join(import.meta.dirname, "..", ".env.example"), "utf8");

  it("leaves the three keys empty", () => {
    for (const key of SECRET_KEYS) expect(example).toMatch(new RegExp(`^${key}=\\s*$`, "m"));
    expect(example).not.toMatch(/^(AUTHOR_SESSION_SECRET|TOKEN_PEPPER|IP_HASH_SALT)=\S/m);
  });

  it("says how to make them", () => {
    expect(example.match(/openssl rand -hex 32/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
