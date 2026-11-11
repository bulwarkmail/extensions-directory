// Run: npx vitest run tests/session-secret-near-copies.test.ts
//
// In production the session secret has to be unrelated to every value this repository
// ever held for it (lib/auth/secrets.ts). A copy of such a value with a character added,
// changed or left out, with the quotes a loader left around it, with other separators,
// joined with another one or written backwards is refused like the value itself: the
// server does not start, and the session code neither opens nor issues a cookie with it.
// A generated secret never comes close to a published value; the controls further down
// check that every kind an operator would make stays accepted.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { sealData, unsealData } from "iron-session";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { freshSecret } from "./helpers/secrets";

const DEV_KEY = "complex_password_at_least_32_characters_long_for_dev";
const EXAMPLE = "change-me-author-session-secret-min-32-chars!!";
// The development keys of the source and the values .env.example carried.
const PUBLISHED = [DEV_KEY, "complex_admin_password_at_least_32_chars_for_dev", EXAMPLE, "change-me-admin-session-secret-min-32-chars!!!"];
// What earlier tests of this repository started a production server with.
const FROM_TESTS = ["http-test-session-secret-0123456789abcdef", "a-real-secret-of-more-than-32-characters-0123"];
const EVERY_PUBLISHED = [...PUBLISHED, ...FROM_TESTS];
const jar = () => (globalThis as { __cookieJar?: Map<string, string> }).__cookieJar!;

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

const seal = (password: string) => sealData({ authorId: "boss", epoch: 0 }, { password, ttl: 3600 });

function server(secret: string, nodeEnv = "production"): void {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("AUTHOR_SESSION_SECRET", secret);
  vi.resetModules();
}

/**
 * What the production check says about a secret: the error's text, or null when it is
 * accepted. sessionSecret() is what the start check and the session code both call.
 */
async function judge(): Promise<(secret: string) => string | null> {
  vi.stubEnv("NODE_ENV", "production");
  const { sessionSecret } = await import("@/lib/auth/session");
  return (secret) => {
    vi.stubEnv("AUTHOR_SESSION_SECRET", secret);
    try {
      sessionSecret();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
}

const NEAR_COPIES: [string, string][] = [
  ["the example value with 1 added", `${EXAMPLE}1`],
  ["the example value with the year added", `${EXAMPLE}2026`],
  ["the example value with a letter in front", `x${EXAMPLE}`],
  ["the example value in the double quotes a loader left in", `"${EXAMPLE}"`],
  ["the example value in single quotes", `'${EXAMPLE}'`],
  ["the example value with its last character changed", `${EXAMPLE.slice(0, -1)}?`],
  ["the example value without its change-me", EXAMPLE.replace("change-me-", "")],
  ["the example value with a zero-width space in front", `\u200B${EXAMPLE}`],
  ["the development key with 1 added", `${DEV_KEY}1`],
  ["the development key in double quotes", `"${DEV_KEY}"`],
  ["the old admin example value with a full stop added", `${PUBLISHED[3]}.`],
  ["the old admin development key with 123 added", `${PUBLISHED[1]}123`],
  ["two published values one after the other", `${EXAMPLE}${DEV_KEY}`],
  ["the example value with 1 added, in quotes, upper case and with a line end", `"${EXAMPLE.toUpperCase()}1"\r\n`],
  ["the example value written backwards", [...EXAMPLE].reverse().join("")],
  ["the development key written backwards with 1 added", `${[...DEV_KEY].reverse().join("")}1`],
  ["the example value with underscores for its hyphens", EXAMPLE.replaceAll("-", "_")],
  ["the example value with spaces for its hyphens", EXAMPLE.replaceAll("-", " ")],
  ["the example value without its punctuation", EXAMPLE.replace(/[^a-z0-9]/g, "")],
  ["the development key with hyphens for its underscores and a typo", DEV_KEY.replaceAll("_", "-").replace("password", "passwort")],
  ["the development key without its underscores, with 1 added", `${DEV_KEY.replaceAll("_", "")}1`],
  ["the first 32 characters of the example value", EXAMPLE.slice(0, 32)],
  ["the last 32 characters of the development key", DEV_KEY.slice(-32)],
  ["a piece of the example value filled up with random digits", `${EXAMPLE.slice(10, 30)}${crypto.randomBytes(8).toString("hex")}`],
  ["a value an earlier test used, with 1 added", `${FROM_TESTS[0]}1`],
  ["the other value an earlier test used, with its first character left out", FROM_TESTS[1].slice(1)],
];

describe("a near copy of a published value as the production session secret", () => {
  it.each(NEAR_COPIES)("%s: the server refuses to start", async (_name, secret) => {
    server(secret);
    expect(await startRefused()).toBe(true);
  });

  it.each(NEAR_COPIES)("%s: a cookie sealed with it is no session", async (_name, secret) => {
    server(secret);
    expect(await whoIs(await seal(secret))).toBe(null);
  });

  it.each(NEAR_COPIES)("%s: the reason given is that it is close to a published value", async (_name, secret) => {
    const problem = (await judge())(secret);
    expect(problem).toContain("published with the source code, or close to one");
  });
});

describe("small edits of every published value", () => {
  // None of these is refused for its length: the shortest published value has 41 characters.
  const edits = (p: string, i: number) => [`${p.slice(0, i)}~${p.slice(i)}`, `${p.slice(0, i)}~${p.slice(i + 1)}`, p.slice(0, i) + p.slice(i + 1)];

  it.each(EVERY_PUBLISHED)("%s: one character added, changed or left out, at every place", async (p) => {
    const problem = await judge();
    const accepted: string[] = [];
    for (let i = 0; i <= p.length; i++) for (const v of edits(p, i)) if (!problem(v)?.includes("published")) accepted.push(v);
    expect(accepted).toEqual([]);
  });

  it.each(EVERY_PUBLISHED)("%s: two characters added, changed or left out, at every pair of places", async (p) => {
    const problem = await judge();
    const accepted: string[] = [];
    for (let i = 0; i <= p.length; i++) {
      for (const once of edits(p, i)) {
        for (let j = i + 2; j <= once.length; j++) for (const v of edits(once, j)) if (!problem(v)?.includes("published")) accepted.push(v);
      }
    }
    expect(accepted).toEqual([]);
  });

  it.each(EVERY_PUBLISHED)("%s: every tenth character changed, so that no long piece is left whole", async (p) => {
    const problem = await judge();
    for (const offset of [0, 3, 7]) {
      const v = [...p].map((c, i) => (i % 10 === offset ? "~" : c)).join("");
      expect(problem(v)).toContain("published");
    }
  });

  it.each(EVERY_PUBLISHED)("%s: written backwards, with other separators, without them, cut to 32 characters", async (p) => {
    const problem = await judge();
    const backwards = [...p].reverse().join("");
    for (const v of [backwards, `${backwards}1`, p.replace(/[-_]/g, "."), `${p.replace(/[-_]/g, ".")}1`, p.replace(/[^a-z0-9]/g, ""), `x${p.replace(/[^a-z0-9]/g, "").slice(0, -1)}`, p.slice(0, 32), p.slice(-32)]) {
      expect(problem(v)).toContain("published");
    }
  });

  it("every published value written twice or joined with another one is refused", async () => {
    const problem = await judge();
    for (const a of EVERY_PUBLISHED) for (const b of EVERY_PUBLISHED) expect(problem(a + b)).not.toBe(null);
  });

  it("the reason never contains the secret or a published value", async () => {
    const problem = await judge();
    for (const p of EVERY_PUBLISHED) {
      for (const v of [p, `${p}1`, p.toUpperCase(), [...p].reverse().join("")]) {
        const text = problem(v)!.toLowerCase();
        expect(text).not.toContain(v.toLowerCase());
        for (const known of EVERY_PUBLISHED) expect(text).not.toContain(known.slice(0, 16));
      }
    }
  });
});

describe("a cookie handed out with a near copy as the secret", () => {
  // One printable ASCII character added in front or behind, or quotes around:
  // 4 published values x (95 + 95 + 2) = 768 candidates.
  const PRINTABLE = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
  const candidates = () => PUBLISHED.flatMap((p) => [...PRINTABLE.map((c) => p + c), ...PRINTABLE.map((c) => c + p), `"${p}"`, `'${p}'`]);

  it.each([
    ["the example value with 1 added", `${EXAMPLE}1`],
    ["the example value in double quotes", `"${EXAMPLE}"`],
    ["the development key with ! in front", `!${DEV_KEY}`],
  ])("%s: the cookie of a sign-in that was only started gives nothing away", async (_name, secret) => {
    server(secret);
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
    // No cookie is issued, so none of the candidates can open one or lead to a session.
    let found: string | null = null;
    let tried = 0;
    if (cookie) {
      for (const candidate of candidates()) {
        tried++;
        const data = await unsealData<{ oauthState?: string }>(cookie, { password: candidate, ttl: 14 * 24 * 3600 }).catch(() => ({} as { oauthState?: string }));
        if (data.oauthState) { found = candidate; break; }
      }
    }
    const signedInAs = found ? await whoIs(await seal(found)) : null;
    expect({ cookieIssued: Boolean(cookie), secretFound: found !== null, tried, signedInAs }).toEqual({ cookieIssued: false, secretFound: false, tried: 0, signedInAs: null });
  });
});

describe("secrets written out in this repository", () => {
  const ROOT = path.join(import.meta.dirname, "..");
  const KEYS = "AUTHOR_SESSION_SECRET|ADMIN_SESSION_SECRET|TOKEN_PEPPER|IP_HASH_SALT";
  const QUOTED = "([\"'`])((?:(?!\\1)[^\\\\\\r\\n]|\\\\.)*)\\1";
  const CODE = /\.(ts|tsx|mts|js|mjs|cjs)$/;

  /** Tests, CI, deploy files and docs: everything outside the app's own source. */
  function files(): string[] {
    const found = ["README.md", ".env.example", "docker-compose.yml", "Dockerfile"].filter((f) => fs.existsSync(path.join(ROOT, f)));
    const walk = (dir: string) => {
      if (!fs.existsSync(path.join(ROOT, dir))) return;
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!["dist", "node_modules", "__snapshots__"].includes(entry.name)) walk(rel);
        } else found.push(rel);
      }
    };
    for (const dir of ["tests", ".github", "docs", "deploy"]) walk(dir);
    return found;
  }

  /**
   * The fixed values a file gives one of the secret settings: after the setting's name
   * (KEY=value, KEY: "value", stubEnv("KEY", "value")), and in code also a string assigned
   * to a constant named like a secret. Values computed when the file runs are not fixed.
   */
  function writtenOut(file: string, text: string): string[] {
    const values: string[] = [];
    for (const m of text.matchAll(new RegExp(`\\b(?:${KEYS})\\b["'\`]?\\s*[=:,]\\s*${QUOTED}`, "g"))) values.push(m[2]);
    if (CODE.test(file)) {
      for (const m of text.matchAll(new RegExp(`\\b(?:const|let|var)\\s+\\w*(?:secret|pepper|salt|password)\\w*\\s*=\\s*${QUOTED}`, "gi"))) values.push(m[2]);
    } else {
      for (const m of text.matchAll(new RegExp(`^\\s*(?:export\\s+|-\\s+)?(?:${KEYS})\\s*[=:]\\s*([^\\s"'\`#]+)\\s*$`, "gm"))) values.push(m[1]);
    }
    return values.filter((v) => !v.includes("${") && !v.includes("$("));
  }

  it("none of them is accepted in production", async () => {
    const problem = await judge();
    const accepted: string[] = [];
    for (const file of files()) {
      for (const value of writtenOut(file, fs.readFileSync(path.join(ROOT, file), "utf8"))) if (problem(value) === null) accepted.push(`${file}: ${value}`);
    }
    expect(accepted).toEqual([]);
  });

  it("the search finds a value in each place it can stand (control)", async () => {
    const problem = await judge();
    const own = freshSecret();
    const samples: [string, string][] = [
      [".env.example", `AUTHOR_SESSION_SECRET=${own}\n`],
      [".env.example", `TOKEN_PEPPER="${own}"\n`],
      [".github/workflows/x.yml", `          IP_HASH_SALT: ${own}\n`],
      ["deploy/x.sh", `export AUTHOR_SESSION_SECRET='${own}' PORT=3100\n`],
      ["tests/x.test.ts", `vi.stubEnv("AUTHOR_SESSION_SECRET", "${own}");\n`],
      ["tests/x.test.ts", `env: { ...process.env, TOKEN_PEPPER: "${own}" },\n`],
      ["tests/x.test.ts", `const SECRET = "${own}";\n`],
      ["tests/x.test.ts", `  const sessionPassword = '${own}';\n`],
    ];
    expect(problem(own)).toBe(null);
    for (const [file, text] of samples) expect(writtenOut(file, text)).toEqual([own]);
    expect(writtenOut("tests/x.test.ts", "const SECRET = freshSecret();\nvi.stubEnv(\"AUTHOR_SESSION_SECRET\", secret);\n")).toEqual([]);
    expect(writtenOut("deploy/x.sh", "export AUTHOR_SESSION_SECRET=\"$(openssl rand -hex 32)\"\n")).toEqual([]);
  });

  // The two tests that start a production server make their secret when they run.
  const LITERALS: [string, RegExp][] = [
    ["http/admin-pages.http.ts", /const SECRET = "([^"]{32,})"/],
    ["fail-closed-config.test.ts", /const secret = "([^"]{32,})"/],
  ];

  it.each(LITERALS)("tests/%s has no fixed secret that production accepts", async (file, pattern) => {
    const literal = pattern.exec(fs.readFileSync(path.join(import.meta.dirname, file), "utf8"))?.[1];
    if (literal === undefined) return;
    server(literal);
    expect(await startRefused()).toBe(true);
  });
});

describe("secrets an operator makes stay accepted (control)", () => {
  const PASSWORD_CHARS = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i));
  const GENERATORS: [string, number, () => string][] = [
    ["32 random bytes as hex (openssl rand -hex 32)", 10_000, () => crypto.randomBytes(32).toString("hex")],
    ["32 random bytes as base64 (openssl rand -base64 32)", 10_000, () => crypto.randomBytes(32).toString("base64")],
    ["a random UUID", 10_000, () => crypto.randomUUID()],
    ["a password manager's 40 characters", 10_000, () => Array.from({ length: 40 }, () => PASSWORD_CHARS[crypto.randomInt(94)]).join("")],
    ["16 random bytes as hex", 5000, () => crypto.randomBytes(16).toString("hex")],
    ["48 random bytes as base64url", 5000, () => crypto.randomBytes(48).toString("base64url")],
  ];

  it.each(GENERATORS)("%s: %i fresh values are all accepted", async (_name, count, make) => {
    vi.stubEnv("NODE_ENV", "production");
    const { sessionSecret } = await import("@/lib/auth/session");
    for (let i = 0; i < count; i++) {
      const secret = make();
      vi.stubEnv("AUTHOR_SESSION_SECRET", secret);
      expect(sessionSecret()).toBe(secret);
    }
  });

  it.each(["extdir-", "session-", "bulwark_", "prod.secret."])("an own random secret with the label %j in front is accepted", async (label) => {
    const problem = await judge();
    for (let i = 0; i < 200; i++) expect(problem(label + freshSecret())).toBe(null);
  });

  it("a generated secret starts the server and opens its own sessions", async () => {
    const secret = freshSecret();
    server(secret);
    expect(await startRefused()).toBe(false);
    expect(await whoIs(await seal(secret))).toBe("boss");
  });

  it("a generated secret in the quotes a loader left in works as it is", async () => {
    const secret = `"${freshSecret()}"`;
    server(secret);
    expect(await startRefused()).toBe(false);
    expect(await whoIs(await seal(secret))).toBe("boss");
  });
});

describe("exact published values in the forms a file or a loader gives them (control)", () => {
  const FORMS: [string, (v: string) => string][] = [
    ["a byte order mark in front", (v) => `\uFEFF${v}`],
    ["a carriage return and newline behind", (v) => `${v}\r\n`],
    ["two newlines behind", (v) => `${v}\n\n`],
    ["a tab in front and a no-break space behind", (v) => `\t${v}\u00A0`],
    ["mixed case", (v) => v.replace(/[a-z]/g, (c, i: number) => (i % 2 ? c.toUpperCase() : c))],
  ];
  const CASES = PUBLISHED.flatMap((p, n) => FORMS.map(([name, make]) => ({ name: `published value ${n + 1} with ${name}`, secret: make(p) })));

  it.each(CASES)("$name is refused at start and opens no session", async ({ secret }) => {
    server(secret);
    expect(await startRefused()).toBe(true);
    expect(await whoIs(await seal(secret))).toBe(null);
  });

  it("a published value written twice is refused", async () => {
    server(EXAMPLE + EXAMPLE);
    expect(await startRefused()).toBe(true);
  });
});

describe("which NODE_ENV gets the strict check (control)", () => {
  const STRICT = ["Production", "PRODUCTION", " production ", "prod", "staging", "", "Test", "TEST", " test", "development ", "Development", "dev", "ci"];

  it.each(STRICT)("NODE_ENV %j without a secret: no start, and a cookie sealed with the development key is no session", async (env) => {
    server("", env);
    expect(await startRefused()).toBe(true);
    expect(await whoIs(await seal(DEV_KEY))).toBe(null);
  });

  it.each(STRICT)("NODE_ENV %j with the development key as the secret: refused", async (env) => {
    server(DEV_KEY, env);
    expect(await startRefused()).toBe(true);
    expect(await whoIs(await seal(DEV_KEY))).toBe(null);
  });

  it.each(["test", "development"])("NODE_ENV %s: a near copy still works, as the development key does", async (env) => {
    server(`${EXAMPLE}1`, env);
    expect(await startRefused()).toBe(false);
    expect(await whoIs(await seal(`${EXAMPLE}1`))).toBe("boss");
  });
});

describe("changing the secret (control)", () => {
  it("a session sealed with the old secret stops validating at once, and nothing accepts the old one", async () => {
    const before = freshSecret();
    const after = freshSecret();
    server(before);
    const cookie = await seal(before);
    expect(await whoIs(cookie)).toBe("boss");
    // The same process with the variable changed: the options are built per call.
    vi.stubEnv("AUTHOR_SESSION_SECRET", after);
    expect(await whoIs(cookie)).toBe(null);
    // A restarted process with the new secret.
    server(after);
    expect(await whoIs(cookie)).toBe(null);
    expect(await whoIs(await seal(after))).toBe("boss");
  });
});

describe("the start error (control)", () => {
  const BAD: [string, string][] = [
    ["too short", "short-secret-0123456789"],
    ["published", EXAMPLE],
    ["published, upper case", DEV_KEY.toUpperCase()],
    ["one block repeated", "abcabcabcabcabcabcabcabcabcabcabcabc"],
    ["few different characters", "aabbccddeeffaabbccddeeffaabbccdde0"],
    ["a near copy", `${EXAMPLE}1`],
  ];

  it.each(BAD)("%s: the start is refused, and the error names the variable and the fix and never the value", async (_name, secret) => {
    server(secret);
    const error = await startError();
    expect(error).not.toBe(null);
    expect(error!.message).toContain("AUTHOR_SESSION_SECRET");
    expect(error!.message).toContain("openssl rand -hex 32");
    const text = `${error!.message}\n${error!.stack}\n${JSON.stringify(error, Object.getOwnPropertyNames(error))}`.toLowerCase();
    expect(text).not.toContain(secret.toLowerCase());
    expect(text).not.toContain(secret.toLowerCase().slice(0, 16));
  });
});
