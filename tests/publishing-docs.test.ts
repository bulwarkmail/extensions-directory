import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// The CLI in packages/cli is not on npm, so `npx @bulwarkmail/extension-cli`
// fails for authors. The pages authors copy commands from must only name
// things that work: the dashboard, the Action and the HTTP API.
const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");

describe("publishing instructions", () => {
  const pages = ["content/publishing.md", "app/dashboard/tokens/form.tsx"];

  it.each(pages)("%s does not tell authors to run the unpublished CLI", (p) => {
    expect(read(p)).not.toMatch(/extension-cli/);
  });

  it.each(pages)("%s shows a token submission to POST /api/v2/publish", (p) => {
    expect(read(p)).toMatch(/curl -X POST [^\n]*\/api\/v2\/publish /);
  });
});
