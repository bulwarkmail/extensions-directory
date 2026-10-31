import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Footer } from "@/components/footer";

describe("footer", () => {
  it("links the directory's own GitHub repository", () => {
    const html = renderToStaticMarkup(createElement(Footer));
    const github = [...html.matchAll(/href="(https:\/\/github\.com\/[^"]+)"/g)].map((m) => m[1]);
    expect(github).toEqual(["https://github.com/bulwarkmail/extensions-directory"]);
  });
});
