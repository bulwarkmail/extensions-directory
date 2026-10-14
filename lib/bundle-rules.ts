// Shared rules for what goes into a published extension bundle. Used by the
// bundle resolver (lib/pipeline/resolve.ts) and the sandbox output picker
// (lib/pipeline/sandbox.ts). The webmail's own limits are enforced on top by
// lib/webmail-compat.

export const MAX_BUNDLE_FILES = 2000;

export const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".gitignore",
  ".npmignore",
  ".prettierrc",
  ".eslintrc",
  ".eslintrc.json",
  "tsconfig.json",
  "tsconfig.build.json",
  ".DS_Store",
]);

export const SKIP_DIRS = [
  "node_modules/",
  ".git/",
  ".github/",
  "test/",
  "tests/",
  "__tests__/",
];

export const SOURCE_DIRS = ["src/", "source/"];

// Documentation and debug files: useful in a repository, refused by the
// webmail inside a bundle.
const DOC_FILE = /(^|\/)(readme|licen[cs]e|copying|changelog|contributing|notice|authors)(\.[a-z0-9]+)?$/i;
const SKIP_EXT = /\.(md|markdown|txt|map|d\.ts)$/i;

export function shouldSkip(rel: string): boolean {
  const base = rel.split("/").pop() ?? rel;
  if (SKIP_FILES.has(rel) || SKIP_FILES.has(base)) return true;
  for (const d of SKIP_DIRS) if (rel.startsWith(d)) return true;
  return DOC_FILE.test(rel) || SKIP_EXT.test(rel);
}
