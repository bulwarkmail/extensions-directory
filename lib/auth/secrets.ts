// Keys an installation has to bring itself: the secret that seals session
// cookies, the pepper that keys the stored API token hashes and the salt that
// keys the stored address hashes. With NODE_ENV development or test a missing
// one falls back to a fixed value. Everywhere else each must be at least 32
// characters, random, and unrelated to every value that was ever written out
// in this repository, or nothing is sealed or hashed with it
// (instrumentation.ts also refuses to start).
import crypto from "crypto";

const DEVELOPMENT = {
  AUTHOR_SESSION_SECRET: "complex_password_at_least_32_characters_long_for_dev",
  TOKEN_PEPPER: "dev-token-pepper",
  IP_HASH_SALT: "extdir",
};

export type SecretName = keyof typeof DEVELOPMENT;

// Every value this repository ever held for one of these keys: the defaults in
// the source, the lines of .env.example and the secrets its tests used. All of
// them are public, so neither they nor anything close to them counts as an
// installation's own secret, whichever key it is set for. A test that needs a
// refused value takes one from here. Lower case.
const PUBLISHED: string[] = [
  // Defaults in the source.
  ...Object.values(DEVELOPMENT),
  "complex_admin_password_at_least_32_chars_for_dev",
  // .env.example.
  "change-me-author-session-secret-min-32-chars!!",
  "change-me-admin-session-secret-min-32-chars!!!",
  "change-me-random-hex",
  // Tests.
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

/** A shared run of this many characters with a published value is too close to it. */
const SHARED_RUN = 12;

const reversed = (text: string) => [...text].reverse().join("");
const lettersAndDigits = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "");

/** How often each pair of neighbouring characters occurs. */
function pairsOf(text: string): Map<string, number> {
  const pairs = new Map<string, number>();
  for (let i = 0; i + 2 <= text.length; i++) pairs.set(text.slice(i, i + 2), (pairs.get(text.slice(i, i + 2)) ?? 0) + 1);
  return pairs;
}

interface Known {
  text: string;
  /** How many of its characters may be changed, left out or added: a quarter. */
  edits: number;
}

interface KnownSet {
  texts: Known[];
  /** Every stretch of SHARED_RUN characters of every text. */
  runs: Set<string>;
  /** For each pair of neighbours: the texts (by index) that have it, and how often. */
  byPair: Map<string, [number, number][]>;
}

// Each published value forwards and backwards, as written (plain) and without
// its punctuation (bare). A form shorter than the shared run is left out: a
// secret of 32 characters can't be an edited copy of it.
function known(forms: string[]): KnownSet {
  const texts = forms.flatMap((p) => [p, reversed(p)]).filter((p) => p.length >= SHARED_RUN);
  const runs = new Set<string>();
  const byPair = new Map<string, [number, number][]>();
  texts.forEach((p, n) => {
    for (let i = 0; i + SHARED_RUN <= p.length; i++) runs.add(p.slice(i, i + SHARED_RUN));
    for (const [pair, count] of pairsOf(p)) byPair.set(pair, [...(byPair.get(pair) ?? []), [n, count]]);
  });
  return { texts: texts.map((p) => ({ text: p, edits: Math.floor(p.length / 4) })), runs, byPair };
}
const PLAIN = known(PUBLISHED);
const BARE = known(PUBLISHED.map(lettersAndDigits));

// The digests of every published value, as hex: of the value as written and
// in upper case, with no line end, with "\n" and with "\r\n", under each of
// the usual hash commands.
const DIGESTS = ["md5", "sha1", "sha256", "sha384", "sha512"].filter((name) => crypto.getHashes().includes(name));
const PUBLISHED_DIGESTS = new Set(
  PUBLISHED.flatMap((p) => [p, p.toUpperCase()])
    .flatMap((p) => [p, `${p}\n`, `${p}\r\n`])
    .flatMap((text) => DIGESTS.map((name) => crypto.createHash(name).update(text).digest("hex")))
);

/** How often what a value decodes to is decoded again: an encoding of an encoding is still looked into. */
const DECODE_DEPTH = 2;

/**
 * The form a secret is judged in, letter case kept: without the byte order
 * mark, spaces and line ends a file adds, without one pair of quotes a loader
 * left around it, without invisible characters.
 */
function tidy(raw: string): string {
  const clean = (text: string) => text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  let value = clean(raw.normalize("NFKC"));
  const quote = value[0];
  if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) value = clean(value.slice(1, -1));
  return value;
}

/** True when the text is one block repeated, also when the last copy is cut short. */
function repeatsBlock(text: string): boolean {
  for (let period = 1; period <= text.length / 2; period++) {
    let i = period;
    while (i < text.length && text[i] === text[i - period]) i++;
    if (i === text.length) return true;
  }
  return false;
}

/**
 * True when some stretch of the value is the known text with no more than its
 * allowed number of characters changed, left out or added.
 */
function holdsEdited(value: string, k: Known): boolean {
  // column[i]: fewest edits that turn the first i characters of the known
  // text into a stretch of the value that ends at the current position.
  const m = k.text.length;
  let column = new Uint32Array(m + 1).map((_, i) => i);
  let next = new Uint32Array(m + 1);
  for (let j = 0; j < value.length; j++) {
    next[0] = 0;
    for (let i = 1; i <= m; i++) {
      next[i] = Math.min(column[i - 1] + (k.text[i - 1] === value[j] ? 0 : 1), column[i] + 1, next[i - 1] + 1);
    }
    if (next[m] <= k.edits) return true;
    [column, next] = [next, column];
  }
  return false;
}

/** True when the value shares a long run with a known text or holds an edited copy of one. */
function resembles(value: string, { texts, runs, byPair }: KnownSet): boolean {
  for (let i = 0; i + SHARED_RUN <= value.length; i++) if (runs.has(value.slice(i, i + SHARED_RUN))) return true;
  // One edit breaks at most two pairs of neighbours, so an edited copy keeps
  // all but 2 x edits of the text's pairs. Only texts the value shares that
  // many pairs with get the closer look.
  const shared = new Array<number>(texts.length).fill(0);
  for (const [pair, count] of pairsOf(value)) for (const [n, inText] of byPair.get(pair) ?? []) shared[n] += Math.min(count, inText);
  return texts.some((k, n) => shared[n] >= k.text.length - 1 - 2 * k.edits && holdsEdited(value, k));
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function fromBase32(text: string): Buffer {
  const bytes = Buffer.alloc(Math.floor((text.length * 5) / 8));
  let held = 0;
  let bits = 0;
  let at = 0;
  for (const c of text.toLowerCase()) {
    held = (held << 5) | BASE32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = held >> bits;
      held &= (1 << bits) - 1;
    }
  }
  return bytes;
}

/**
 * The bytes a text stands for under each encoding it parses as: hex, base64
 * in either alphabet with or without padding, base32. Line breaks an encoder
 * put in don't count.
 */
function decodings(text: string): Buffer[] {
  const packed = text.replace(/\s+/g, "");
  const found: Buffer[] = [];
  if (/^(?:[0-9a-f]{2})+$/i.test(packed)) found.push(Buffer.from(packed, "hex"));
  const base64 = /^([a-z0-9+/_-]+)={0,2}$/i.exec(packed);
  if (base64 && base64[1].length % 4 !== 1) found.push(Buffer.from(base64[1], "base64"));
  const base32 = /^([a-z2-7]+)={0,6}$/i.exec(packed);
  if (base32) found.push(fromBase32(base32[1]));
  return found;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The bytes as text, or null when they are no text: not UTF-8, or with control characters other than tab and line ends. */
function asText(bytes: Buffer): string | null {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return null;
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 127 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) return null;
  }
  return text;
}

const PUBLISHED_VALUE = "is a value published with the source code, or close to one";
const NOT_RANDOM = "does not look random";

// A generated secret has far more than 8 different characters (64 random hex
// digits have fewer than 8 about once in 10^19 tries).
const lowVariety = (value: string) => new Set(value).size < 8 || repeatsBlock(value);

/** True for a published value, anything close to one, and text that holds the digest of one as hex. */
function published(value: string): boolean {
  if (resembles(value, PLAIN) || resembles(lettersAndDigits(value), BARE)) return true;
  return (value.match(/[0-9a-f]+/g) ?? []).some((run) => PUBLISHED_DIGESTS.has(run));
}

/**
 * What is wrong with what a text decodes to, or null: the bytes are the digest
 * of a published value, or they are text that is published, close to it or of
 * low variety. Decoded text is decoded again `depth - 1` times.
 */
function decodedProblem(text: string, depth: number): string | null {
  for (const bytes of decodings(text)) {
    if (PUBLISHED_DIGESTS.has(bytes.toString("hex"))) return PUBLISHED_VALUE;
    const decoded = asText(bytes);
    if (decoded === null) continue;
    const inner = tidy(decoded);
    const value = inner.toLowerCase();
    if (published(value)) return PUBLISHED_VALUE;
    if (lowVariety(value)) return NOT_RANDOM;
    const deeper = depth > 1 ? decodedProblem(inner, depth - 1) : null;
    if (deeper) return deeper;
  }
  return null;
}

/**
 * What is wrong with a value as a production secret, or null. Never includes
 * the value. This is where the rule ends: known published values, their plain
 * encodings and digests, and low-variety values. Anything further is the
 * operator's own choice of secret.
 */
function problemOf(raw: string): string | null {
  const text = tidy(raw);
  const value = text.toLowerCase();
  if (value.length < 32) return "must be set to at least 32 characters";
  if (lowVariety(value)) return NOT_RANDOM;
  if (published(value)) return PUBLISHED_VALUE;
  return decodedProblem(text, DECODE_DEPTH);
}

// The verdict on the value last seen per key, so that a use costs a lookup.
const judged = new Map<SecretName, { raw: string; problem: string | null }>();

/** What is wrong with the key's value outside development and tests, as a sentence, or null. */
export function secretProblem(name: SecretName): string | null {
  const raw = process.env[name] ?? "";
  let verdict = judged.get(name);
  if (!verdict || verdict.raw !== raw) {
    verdict = { raw, problem: problemOf(raw) };
    judged.set(name, verdict);
  }
  return verdict.problem && `${name} ${verdict.problem}. Generate one with: openssl rand -hex 32`;
}

/** What is wrong with any of the keys outside development and tests: one sentence per key. */
export function secretProblems(): string[] {
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return [];
  return (Object.keys(DEVELOPMENT) as SecretName[]).map(secretProblem).filter((problem) => problem !== null);
}

/**
 * The key's value, exactly as the environment has it. With NODE_ENV
 * development or test a blank one becomes the fixed development value;
 * everywhere else a value that fails the check throws.
 */
export function ownSecret(name: SecretName): string {
  const raw = process.env[name] ?? "";
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return raw.trim() ? raw : DEVELOPMENT[name];
  const problem = secretProblem(name);
  if (problem) throw new Error(problem);
  return raw;
}
