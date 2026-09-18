import type { NormalizedManifest, ResolvedBundle } from "./manifest";

export type Severity = "block" | "warn" | "info";

export interface ScanFinding {
  severity: Severity;
  rule: string;
  message: string;
  file?: string;
  line?: number;
  snippet?: string;
}

export interface ScanReport {
  scannedAt: string;
  fileCount: number;
  totalBytes: number;
  jsFiles: number;
  cssFiles: number;
  findings: ScanFinding[];
  blocked: boolean;
}

interface Rule {
  rule: string;
  pattern: RegExp;
  message: string;
}

// JavaScript / TypeScript — patterns that have no legitimate use in a sandboxed
// Bulwark plugin. Matching one of these blocks the submission.
const JS_BLOCK_RULES: Rule[] = [
  { rule: "js-eval", pattern: /\beval\s*\(/, message: "Use of eval() is not allowed" },
  { rule: "js-new-function", pattern: /\bnew\s+Function\s*\(/, message: "new Function() is not allowed" },
  { rule: "js-document-write", pattern: /\bdocument\s*\.\s*write(?:ln)?\s*\(/, message: "document.write / writeln is not allowed" },
  { rule: "js-document-cookie", pattern: /\bdocument\s*\.\s*cookie\s*[=.]/, message: "Direct document.cookie access is not allowed" },
  { rule: "js-inner-html", pattern: /\binnerHTML\s*=/, message: "innerHTML assignment is not allowed; use textContent or DOM APIs" },
  { rule: "js-outer-html", pattern: /\bouterHTML\s*=/, message: "outerHTML assignment is not allowed" },
  { rule: "js-insert-adjacent-html", pattern: /\binsertAdjacentHTML\s*\(/, message: "insertAdjacentHTML is not allowed; build elements instead" },
  { rule: "js-javascript-url", pattern: /(?:href|src|action|formaction)\s*=\s*["']javascript:/i, message: "javascript: URLs are not allowed" },
  { rule: "js-settimeout-string", pattern: /\bsetTimeout\s*\(\s*['"`]/, message: "setTimeout with a string argument is not allowed (acts like eval)" },
  { rule: "js-setinterval-string", pattern: /\bsetInterval\s*\(\s*['"`]/, message: "setInterval with a string argument is not allowed (acts like eval)" },
  { rule: "js-script-injection", pattern: /createElement\s*\(\s*['"`]script['"`]\s*\)/i, message: "Programmatic <script> creation is not allowed" },
];

// Patterns we surface to the reviewer but don't auto-block. They may be
// legitimate, but warrant a closer look.
const JS_WARN_RULES: Rule[] = [
  { rule: "js-dynamic-import", pattern: /\bimport\s*\(\s*(?!['"`])/, message: "Dynamic import() with a non-literal argument" },
  { rule: "js-wasm", pattern: /\bWebAssembly\s*\.\s*(?:instantiate|compile)/, message: "Uses WebAssembly — may obfuscate behavior" },
  { rule: "js-external-fetch", pattern: /\bfetch\s*\(\s*['"`]https?:\/\/[^'"` ]+/i, message: "Hard-coded external HTTP request — review the destination" },
  { rule: "js-xhr", pattern: /\bnew\s+XMLHttpRequest\s*\(/, message: "Uses XMLHttpRequest — review the destinations it talks to" },
  { rule: "js-websocket", pattern: /\bnew\s+WebSocket\s*\(/, message: "Opens a WebSocket — review the destination" },
  { rule: "js-localstorage-write", pattern: /\b(?:local|session)Storage\s*(?:\.\s*setItem|\[)/, message: "Writes to localStorage / sessionStorage — confirm no PII leak" },
  { rule: "js-send-beacon", pattern: /\bnavigator\s*\.\s*sendBeacon\s*\(/, message: "Uses navigator.sendBeacon — common in trackers" },
  { rule: "js-crypto-mining", pattern: /\b(?:coinhive|cryptonight|webminerpool|nimiq|monero|coin-?(?:hive|imp)|crypto[-_]?loot)\b/i, message: "Possible cryptocurrency miner reference" },
  { rule: "js-base64-blob", pattern: /["'`][A-Za-z0-9+/]{300,}={0,2}["'`]/, message: "Long base64 string literal — may hide payload" },
  { rule: "js-hex-blob", pattern: /(?:\\x[0-9a-fA-F]{2}){25,}/, message: "Long hex-escape sequence — possible obfuscation" },
  { rule: "js-unicode-escape-blob", pattern: /(?:\\u[0-9a-fA-F]{4}){25,}/, message: "Long unicode-escape sequence — possible obfuscation" },
  { rule: "js-iframe-src", pattern: /\.\s*src\s*=\s*['"`]https?:\/\//i, message: "Element src set to an external URL — review the host" },
  { rule: "js-postmessage-star", pattern: /\bpostMessage\s*\([^,]+,\s*['"`]\*['"`]/, message: "postMessage with target origin '*' — narrows trust boundary" },
  { rule: "js-jmap-direct", pattern: /\b(?:fetch|axios)\s*\([^)]*['"`][^'"`]*\/jmap\b/, message: "Direct call to /jmap — plugins should use the host API surface" },
];

// CSS — same approach. Any property/value that has historically been used as
// an XSS sink is blocked outright.
const CSS_BLOCK_RULES: Rule[] = [
  { rule: "css-expression", pattern: /\bexpression\s*\(/i, message: "CSS expression() is not allowed (legacy IE XSS vector)" },
  { rule: "css-behavior", pattern: /\bbehavior\s*:/i, message: "CSS behavior is not allowed (legacy IE XSS vector)" },
  { rule: "css-binding", pattern: /-moz-binding\s*:/i, message: "-moz-binding is not allowed" },
  { rule: "css-javascript-url", pattern: /url\s*\(\s*['"]?\s*javascript:/i, message: "javascript: URL in CSS is not allowed" },
];

const CSS_WARN_RULES: Rule[] = [
  { rule: "css-import-external", pattern: /@import\s+(?:url\s*\(\s*)?['"]?https?:\/\//i, message: "External @import — bundle the resource instead" },
  { rule: "css-external-url", pattern: /url\s*\(\s*['"]?https?:\/\/(?!localhost|127\.0\.0\.1)[^/'") ]+/i, message: "External URL in CSS — bundle the resource instead" },
];

const TEXT_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "css", "scss", "html", "htm",
  "json", "md", "txt", "svg", "yaml", "yml", "map", "webmanifest",
]);

const ALLOWED_BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "ogg", "wav",
]);

const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "so", "dylib", "scr", "bat", "cmd", "com", "msi",
  "vbs", "ps1", "sh", "bash", "py", "rb", "pl", "php",
  "jar", "class",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024; // per file
const MAX_LINE_BYTES = 1000;

function ext(path: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
}

function findLineNumber(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function pickSnippet(text: string, index: number, max = 80): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + max);
  return text
    .slice(start, end)
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 120);
}

function scanText(
  text: string,
  filePath: string,
  blockRules: Rule[],
  warnRules: Rule[],
  findings: ScanFinding[]
): void {
  for (const r of blockRules) {
    const m = r.pattern.exec(text);
    if (!m) continue;
    findings.push({
      severity: "block",
      rule: r.rule,
      message: r.message,
      file: filePath,
      line: findLineNumber(text, m.index),
      snippet: pickSnippet(text, m.index),
    });
  }
  for (const r of warnRules) {
    const m = r.pattern.exec(text);
    if (!m) continue;
    findings.push({
      severity: "warn",
      rule: r.rule,
      message: r.message,
      file: filePath,
      line: findLineNumber(text, m.index),
      snippet: pickSnippet(text, m.index),
    });
  }
}

function looksMinified(text: string): boolean {
  for (const line of text.split("\n")) {
    if (line.length > MAX_LINE_BYTES) return true;
  }
  return false;
}

/**
 * Scan a resolved (flat) per-extension bundle for malicious / disallowed code.
 * Operates on the post-resolution file map so it sees exactly what will be
 * shipped to clients.
 */
export async function scanBundle(
  bundle: ResolvedBundle,
  manifest: NormalizedManifest
): Promise<ScanReport> {
  const findings: ScanFinding[] = [];
  let fileCount = 0;
  let totalBytes = 0;
  let jsFiles = 0;
  let cssFiles = 0;
  let entrypointFound = false;
  let themeCssFound = false;

  for (const [rel, data] of bundle.files) {
    fileCount++;
    const e = ext(rel);

    if (BLOCKED_EXTENSIONS.has(e)) {
      findings.push({
        severity: "block",
        rule: "file-blocked-type",
        message: `Disallowed file type: .${e}`,
        file: rel,
      });
      continue;
    }

    totalBytes += data.byteLength;

    if (data.byteLength > MAX_FILE_BYTES) {
      findings.push({
        severity: "warn",
        rule: "file-too-large",
        message: `File exceeds ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB`,
        file: rel,
      });
    }

    if (rel === manifest.entrypoint) entrypointFound = true;
    if (manifest.type === "theme" && rel === "theme.css") themeCssFound = true;

    const isJs = ["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(e);
    const isCss = ["css", "scss"].includes(e);
    const isText = TEXT_EXTENSIONS.has(e);
    const isAllowedBinary = ALLOWED_BINARY_EXTENSIONS.has(e);

    if (!isText && !isAllowedBinary) {
      findings.push({
        severity: "warn",
        rule: "unknown-extension",
        message: `Unknown file type: .${e || "(no extension)"}`,
        file: rel,
      });
      continue;
    }

    if (!isText) continue;

    const text = Buffer.from(data).toString("utf-8");

    if (isJs) {
      jsFiles++;
      scanText(text, rel, JS_BLOCK_RULES, JS_WARN_RULES, findings);
      if (looksMinified(text)) {
        findings.push({
          severity: "warn",
          rule: "minified-source",
          message: "File looks minified — submit readable source",
          file: rel,
        });
      }
    } else if (isCss) {
      cssFiles++;
      scanText(text, rel, CSS_BLOCK_RULES, CSS_WARN_RULES, findings);
    }
  }

  if (!entrypointFound && manifest.type === "plugin") {
    findings.push({
      severity: "block",
      rule: "missing-entrypoint",
      message: `Manifest declares entrypoint "${manifest.entrypoint}" but the file is not in the bundle (looked in subpath/, subpath/dist/, subpath/build/, and for a prebuilt ${manifest.slug}.zip)`,
    });
  }
  if (manifest.type === "theme" && !themeCssFound) {
    findings.push({
      severity: "block",
      rule: "missing-theme-css",
      message: "Theme bundle must contain theme.css",
    });
  }
  if (manifest.type === "plugin" && jsFiles === 0) {
    findings.push({
      severity: "warn",
      rule: "no-js-files",
      message: "Plugin bundle contains no JavaScript files",
    });
  }

  const blocked = findings.some((f) => f.severity === "block");

  return {
    scannedAt: new Date().toISOString(),
    fileCount,
    totalBytes,
    jsFiles,
    cssFiles,
    findings,
    blocked,
  };
}
