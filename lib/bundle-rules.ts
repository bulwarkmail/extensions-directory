// Shared rules for what goes into a published extension bundle. Used by the
// zipball resolver (lib/manifest.ts) and the sandboxed server-side builder
// (lib/sandbox-build.ts).

export const MAX_BUNDLE_BYTES = 10 * 1024 * 1024; // 10 MB (compressed zip)
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

export function shouldSkip(rel: string): boolean {
  if (SKIP_FILES.has(rel)) return true;
  for (const d of SKIP_DIRS) if (rel.startsWith(d)) return true;
  return false;
}
