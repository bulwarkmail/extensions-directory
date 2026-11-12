// Characters that change how code reads, or hide content, without showing must
// reach the reviewer escaped: every control and format character except tab,
// line feed and carriage return, the bidirectional controls, and every
// default-ignorable code point (zero-width characters, variation selectors, tag
// characters, Hangul fillers that are valid in identifiers). The scan names a
// file that holds any.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { showHidden } from "@/lib/hidden-characters";
import { scanBundle } from "@/lib/scanner";
import { validateManifest } from "@/lib/manifest";

const cp = (n: number) => String.fromCodePoint(n);
const MUST_ESCAPE = /^[\p{Cc}\p{Cf}\p{Bidi_Control}\p{Default_Ignorable_Code_Point}]$/u;

describe("hidden characters on the review page", () => {
  it("escapes the bidirectional overrides and isolates, the marks and the zero-width characters", () => {
    for (const n of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]) {
      expect(showHidden(`a${cp(n)}b`), n.toString(16)).toBe(`a\\u${n.toString(16).padStart(4, "0")}b`);
    }
  });

  it("escapes the Arabic letter mark, the Hangul fillers, variation selectors and tag characters", () => {
    for (const n of [0x061c, 0x00ad, 0x034f, 0x115f, 0x1160, 0x3164, 0xffa0, 0x180e, 0xfe0f]) {
      expect(showHidden(`x${cp(n)}y`), n.toString(16)).toBe(`x\\u${n.toString(16).padStart(4, "0")}y`);
    }
  });

  it("writes a code point above U+FFFF as one escape", () => {
    expect(showHidden(`[${cp(0xe0041)}${cp(0xe0100)}${cp(0x1d173)}]`)).toBe("[\\u{e0041}\\u{e0100}\\u{1d173}]");
  });

  it("escapes every control, format, bidi and default-ignorable code point but tab and line breaks", () => {
    const missed: string[] = [];
    for (let n = 0; n <= 0x10ffff; n++) {
      if ((n >= 0xd800 && n <= 0xdfff) || n === 0x09 || n === 0x0a || n === 0x0d) continue;
      const ch = cp(n);
      if (MUST_ESCAPE.test(ch) && showHidden(`a${ch}b`).includes(ch)) missed.push(n.toString(16));
    }
    expect(missed).toEqual([]);
  });

  it("leaves tab, line breaks, letters of any script and emoji themselves alone", () => {
    const plain = "const name = \"Ünïcødé — 名前 — مرحبا — 😀\";\n\tif (a)\r\n  b();\n";
    expect(showHidden(plain)).toBe(plain);
  });

  it("keeps a file full of variation selectors readable, one short escape each, in one pass", () => {
    const line = `  "${cp(0x1f600)}${cp(0xfe0f)}",\n`;
    const shownLine = `  "${cp(0x1f600)}\\ufe0f",\n`;
    for (const n of [50_000, 100_000]) {
      const out = showHidden(line.repeat(n));
      expect(out.length).toBe(shownLine.length * n);
      expect(out.slice(0, shownLine.length * 2)).toBe(shownLine.repeat(2));
    }
  });

  it("is the helper the review page uses", () => {
    const page = fs.readFileSync(path.resolve(import.meta.dirname, "../app/admin/submissions/[id]/files.tsx"), "utf8");
    expect(page).toContain("from \"@/lib/hidden-characters\"");
    expect(page).not.toMatch(/\.replace\(\s*\/\[/);
  });
});

describe("the scan", () => {
  const manifest = (() => {
    const v = validateManifest({ id: "probe", name: "Probe", version: "1.0.0", author: "Test", description: "x", type: "ui-extension", entrypoint: "index.js" });
    if (!v.ok) throw new Error(v.error);
    return v.manifest;
  })();
  const findings = async (files: Record<string, string>) =>
    (await scanBundle({ files: new Map(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)])) }, manifest)).findings;

  it("names a file that holds hidden characters, with their count and the first line", async () => {
    const f = await findings({ "index.js": "module.exports = {};\n", "helper.js": `// one\nconst x = "${cp(0x202e)}";\nconst ${cp(0x3164)} = "${cp(0xe0041)}";\n` });
    const hidden = f.filter((x) => x.rule === "text-hidden-characters");
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toMatchObject({ file: "helper.js", line: 2, severity: "warn" });
    expect(hidden[0].message).toMatch(/^3 invisible characters/);
  });

  it("leaves a clean file and a file with only a NUL byte to the other rules", async () => {
    const f = await findings({ "index.js": "module.exports = { activate() { return \"😀\"; } };\n", "nul.js": "/* \u0000 */\n" });
    expect(f.filter((x) => x.rule === "text-hidden-characters")).toEqual([]);
    expect(f.filter((x) => x.rule === "text-nul-byte").map((x) => x.file)).toEqual(["nul.js"]);
  });
});
