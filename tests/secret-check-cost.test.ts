// Run: npx vitest run tests/secret-check-cost.test.ts
//
// The secret check reads whatever .env holds, so the work of its repeated-block rule has
// to grow in step with the length of the value: it looks at each character a bounded
// number of times. The test counts the characters read, not the time, and compares the
// rule's answers with the plain definition.
import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { repeatsBlock } from "@/lib/auth/secrets";

/** A text's characters as a list that counts every read of one of them. */
function counted(text: string): { chars: ArrayLike<string>; reads: () => number } {
  let reads = 0;
  const chars = new Proxy(text.split(""), {
    get(target, key, receiver) {
      if (typeof key === "string" && key !== "length") reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { chars, reads: () => reads };
}

/** The definition: some block of at most half the text, repeated, gives the text; the last copy may be cut short. */
function repeatsBlockPlainly(text: string): boolean {
  for (let period = 1; period <= text.length / 2; period++) {
    let i = period;
    while (i < text.length && text[i] === text[i - period]) i++;
    if (i === text.length) return true;
  }
  return false;
}

const hex = (n: number) => crypto.randomBytes(n).toString("hex").slice(0, n);

// What a value of n characters can look like, with the answer the rule has to give.
const SHAPES: [string, (n: number) => string, boolean][] = [
  ["one character, then eight others", (n) => "a".repeat(n - 8) + "bcdefghi", false],
  ["one character throughout", (n) => "a".repeat(n), true],
  ["two characters taking turns", (n) => "ab".repeat(n / 2), true],
  ["random hex digits", (n) => hex(n), false],
  ["a random block of 1,000 repeated", (n) => hex(1000).repeat(n / 1000), true],
  ["a random block of 1,000 repeated, the last character changed", (n) => `${hex(1000).repeat(n / 1000).slice(0, -1)}~`, false],
  ["one character, a second one in the middle and at the end", (n) => `${"a".repeat(n / 2 - 1)}b`.repeat(2), true],
  ["one character, a second one once just behind the middle", (n) => `${"a".repeat(n / 2)}b${"a".repeat(n / 2 - 1)}`, false],
];

describe("the repeated-block rule on long values", () => {
  it.each(SHAPES)("%s: twice the length is about twice the reads, and never more than six per character", (_name, make, expected) => {
    const reads = [20_000, 40_000, 80_000].map((n) => {
      const text = counted(make(n));
      expect(repeatsBlock(text.chars)).toBe(expected);
      expect(text.reads()).toBeLessThanOrEqual(6 * n);
      return text.reads();
    });
    expect(reads[1] / reads[0]).toBeLessThan(2.2);
    expect(reads[2] / reads[1]).toBeLessThan(2.2);
  });
});

describe("the repeated-block rule gives the answers of its definition", () => {
  it("for every text of up to 13 characters over two letters and up to 8 over three", () => {
    const wrong: string[] = [];
    const walk = (alphabet: string, text: string, longest: number) => {
      if (repeatsBlock(text) !== repeatsBlockPlainly(text)) wrong.push(text);
      if (text.length < longest) for (const c of alphabet) walk(alphabet, text + c, longest);
    };
    walk("ab", "", 13);
    walk("abc", "", 8);
    expect(wrong).toEqual([]);
  });

  it("for 20,000 random texts, half of them a block repeated and cut at a random place", () => {
    const wrong: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const alphabet = "abcd".slice(0, 2 + crypto.randomInt(3));
      const random = (n: number) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
      const text = i % 2 ? random(crypto.randomInt(80)) : random(1 + crypto.randomInt(12)).repeat(1 + crypto.randomInt(6)).slice(0, -crypto.randomInt(12) || undefined);
      if (repeatsBlock(text) !== repeatsBlockPlainly(text)) wrong.push(text);
    }
    expect(wrong).toEqual([]);
  });
});
