import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders Markdown", () => {
    expect(renderMarkdown("Some **bold** and `code`.\n\n- one\n- two")).toBe(
      "<p>Some <strong>bold</strong> and <code>code</code>.</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n"
    );
  });

  it("keeps the simple HTML older descriptions hold", () => {
    expect(renderMarkdown("<p>Calls <b>from mail</b>.</p>")).toContain("<p>Calls <b>from mail</b>.</p>");
  });

  it.each([
    ["<script>alert(1)</script>", "alert"],
    ['<img src=x onerror="alert(1)">', "onerror"],
    ['<a href="javascript:alert(1)">x</a>', "javascript:"],
    ["[x](javascript:alert(1))", "javascript:"],
    ['<iframe src="https://evil.example"></iframe>', "iframe"],
    ['<svg><script>alert(1)</script></svg>', "alert"],
    ['<p style="background:url(https://t.example)">x</p>', "style"],
    ['<form action="https://evil.example"><input name=p></form>', "form"],
    ["![tracker](https://t.example/p.gif)", "t.example"],
    ['<a href="//evil.example">x</a>', "evil.example"],
  ])("removes %s", (input, needle) => {
    expect(renderMarkdown(input)).not.toContain(needle);
  });

  it("marks links as untrusted and opens them in a new tab", () => {
    expect(renderMarkdown("[docs](https://example.org)")).toBe(
      '<p><a href="https://example.org" rel="nofollow ugc noopener noreferrer" target="_blank">docs</a></p>\n'
    );
  });

  it("moves headings below the page title", () => {
    expect(renderMarkdown("# Title")).toBe("<h2>Title</h2>\n");
  });
});
