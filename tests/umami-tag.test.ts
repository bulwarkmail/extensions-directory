import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// The layout imports next/font, which only works inside the Next compiler,
// so this reads the Umami <script> element from the source instead.
describe("Umami script tag", () => {
  it("tells Umami to respect Do Not Track", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "app", "layout.tsx"), "utf8");
    const tag = src.match(/<script\b[^>]*data-website-id=[^>]*\/>/)?.[0];
    expect(tag, "no Umami script tag in app/layout.tsx").toBeDefined();
    expect(tag).toMatch(/data-do-not-track="true"/);
  });
});
