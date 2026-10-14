// Author-written text (long descriptions, changelogs) rendered for the
// directory's pages. Authors write Markdown; older entries hold plain HTML,
// which Markdown passes through. Either way the result goes through an
// allowlist sanitizer, because it is shown on the directory's origin where
// sessions live.
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "strong", "b", "em", "i", "del", "s", "code", "pre",
    "blockquote", "ul", "ol", "li", "h2", "h3", "h4", "h5", "h6",
    "a", "table", "thead", "tbody", "tr", "th", "td",
  ],
  // Transforms run before this filter, so the rel and target they add stay.
  allowedAttributes: { a: ["href", "title", "rel", "target"], th: ["align"], td: ["align"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    // An author's "# Title" must not compete with the page's own h1.
    h1: "h2",
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow ugc noopener noreferrer", target: "_blank" }),
  },
  // Images would let an author track every visitor; they are dropped like
  // any other tag not listed. Scriptable tags go with their contents.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "svg", "math", "title"],
};

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, gfm: true });
  return sanitizeHtml(html, SANITIZE);
}
