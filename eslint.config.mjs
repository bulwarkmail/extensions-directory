import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "deploy/dist/**",
    "packages/cli/dist/**",
    "action/dist/**",
    // Verbatim copies of webmail files (scripts/sync-webmail-compat.mjs).
    "lib/webmail-compat/vendor/**",
  ]),
  // Node scripts run outside Next as CommonJS, so require() is expected.
  {
    files: ["scripts/**/*.js", "deploy/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
