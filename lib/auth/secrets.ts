// Keys an installation has to bring itself. With NODE_ENV development or test
// a missing one falls back to a fixed value. Everywhere else the value must be
// at least 32 characters, random, and unrelated to every value that was ever
// written out in this repository, or nothing is sealed with it
// (instrumentation.ts also refuses to start).
export type SecretName = "AUTHOR_SESSION_SECRET";

const DEVELOPMENT: Record<SecretName, string> = {
  AUTHOR_SESSION_SECRET: "complex_password_at_least_32_characters_long_for_dev",
};

// Every value this repository ever held for one of these keys: the defaults in
// the source, the lines of .env.example and the secrets its tests used. All of
// them are public, so neither they nor anything close to them counts as an
// installation's own secret. A test that needs a refused value takes one from
// here. Lower case.
const PUBLISHED: string[] = [
  // Defaults in the source.
  DEVELOPMENT.AUTHOR_SESSION_SECRET,
  "complex_admin_password_at_least_32_chars_for_dev",
  // .env.example.
  "change-me-author-session-secret-min-32-chars!!",
  "change-me-admin-session-secret-min-32-chars!!!",
  // Tests.
  "http-test-session-secret-0123456789abcdef",
  "a-real-secret-of-more-than-32-characters-0123",
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

/**
 * The form a secret is judged in: without the byte order mark, spaces and
 * line ends a file adds, without one pair of quotes a loader left around it,
 * without invisible characters, in lower case.
 */
function normalise(raw: string): string {
  const clean = (text: string) => text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  let value = clean(raw.normalize("NFKC"));
  const quote = value[0];
  if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) value = clean(value.slice(1, -1));
  return value.toLowerCase();
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

/** What is wrong with a value as a production secret, or null. Never includes the value. */
function problemOf(raw: string): string | null {
  const value = normalise(raw);
  if (value.length < 32) return "must be set to at least 32 characters";
  // A generated secret has far more than 8 different characters (64 random
  // hex digits have fewer than 8 about once in 10^19 tries).
  if (new Set(value).size < 8 || repeatsBlock(value)) return "does not look random";
  if (resembles(value, PLAIN) || resembles(lettersAndDigits(value), BARE)) return "is a value published with the source code, or close to one";
  return null;
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
