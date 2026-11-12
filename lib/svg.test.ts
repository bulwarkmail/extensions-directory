import { describe, expect, it } from "vitest";
import { checkedSvg } from "./svg";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const svg = (body: string, attrs = "") => `<svg ${NS} ${attrs} width="16" height="12">${body}</svg>`;
const DATA = "data:image/svg+xml;base64,PHN2Zy8+";

function reason(text: string): string {
  const out = checkedSvg(text);
  return out.ok ? `drawn: ${out.svg}` : out.reason;
}

describe("checkedSvg refuses", () => {
  it.each([
    ["a DOCTYPE", `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY c "red">]>${svg('<rect fill="&c;"/>')}`, /DOCTYPE/],
    ["an xml-stylesheet instruction", `<?xml version="1.0"?><?xml-stylesheet type="text/css" href="#s"?>${svg("")}`, /processing instructions/],
    ["another processing instruction", svg("<?php echo 1 ?>"), /processing instructions/],
    ["an XML declaration after a comment", `<!-- c --><?xml version="1.0"?>${svg("")}`, /processing instructions/],
    ["an XInclude", svg(`<xi:include href="${DATA}" parse="xml"/>`, 'xmlns:xi="http://www.w3.org/2001/XInclude"'), /only SVG elements/],
    ["an element of another namespace", svg('<x:thing xmlns:x="urn:x"/>'), /only SVG elements/],
    ["a default namespace switched inside", svg('<g xmlns="urn:x"><rect/></g>'), /only SVG elements/],
    ["foreignObject", svg("<foreignObject/>"), /<foreignObject> is not allowed/],
    ["a script", svg("<script>1</script>"), /scripts/],
    ["an event handler", svg('<rect onclick="1"/>'), /scripts/],
    ["an embedded raster image", svg('<image href="data:image/png;base64,iVBORw0KGgo="/>'), /<image> is not allowed/],
    ["a style element", svg("<style>rect{fill:red}</style>"), /<style> is not allowed/],
    ["a nested svg", svg(`<svg ${NS}/>`), /<svg> is not allowed/],
    ["a root other than svg", `<rect ${NS}/>`, /<rect> is not allowed/],
    ["a use of a data: URL", svg(`<use href="${DATA}#r"/>`), /external/],
    ["a use of another file", svg('<use xlink:href="other.svg#r"/>', XLINK), /external/],
    ["a gradient href to another file", svg('<linearGradient id="g" href="https://example.invalid/g.svg#g"/>'), /external/],
    ["a fill url() to a data: URL", svg(`<rect fill="url(${DATA}#g)"/>`), /external/],
    ["a filter url() to another file", svg('<rect filter="url(f.svg#f)"/>'), /external/],
    ["a url() spelled with character references", svg(`<rect fill="u&#x72;l(${DATA}#g)"/>`), /external/],
    ["a url() in an attribute that takes none", svg('<rect stroke-width="url(#a)"/>'), /external/],
    ["a second url() after a reference", svg('<rect fill="url(#a) url(x)"/>'), /external/],
    ["a CSS escape in an attribute", svg('<rect fill="\\75rl(x)"/>'), /escapes/],
    ["a CSS escape in a style", svg('<rect style="fill:u\\72l(x)"/>'), /escapes/],
    ["an @import in a style", svg('<rect style="fill:red;@import x"/>'), /escapes/],
    ["a comment in a style", svg('<rect style="fill:/* x */red"/>'), /escapes/],
    ["a url() to a data: URL in a style", svg(`<rect style="fill:url(${DATA}#g)"/>`), /external/],
    ["a style declaration without a value", svg('<rect style="fill"/>'), /not readable/],
    ["a quote left open in a style", svg(`<rect style="font-family:'a;fill:red"/>`), /not readable/],
  ])("%s", (_name, text, why) => {
    expect(reason(text)).toMatch(why);
  });
});

describe("checkedSvg refuses what is not well-formed", () => {
  it.each([
    ["an end tag of another element", `<svg ${NS}><g></svg>`],
    ["an element left open", `<svg ${NS}><g>`],
    ["an end tag that matches nothing", `<svg ${NS}></g></svg>`],
    ["an unquoted attribute", `<svg ${NS}><rect width=5/></svg>`],
    ["an attribute without a value", `<svg ${NS}><rect hidden/></svg>`],
    ["the same attribute twice", `<svg ${NS}><rect width="1" width="2"/></svg>`],
    ["text after the root", `${svg("")}tail`],
    ["a second root", `${svg("")}${svg("")}`],
    ["a stray <", svg("<text>a < b</text>")],
    ["an entity XML doesn't define", svg("<text>&nbsp;</text>")],
    ["a bare ampersand", svg("<text>a & b</text>")],
    ["a control character", svg(`<text>a${String.fromCharCode(1)}</text>`)],
    ["an undeclared prefix", svg("<p:rect/>")],
  ])("%s", (_name, text) => {
    expect(reason(text)).toMatch(/not well-formed|Not an SVG/);
  });
});

describe("checkedSvg writes out what it checked", () => {
  it("drops comments, declarations, foreign attributes and unknown properties", () => {
    const text =
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by hand -->\n` +
      `<svg ${NS} ${XLINK} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="16" height="12" class="icon" data-x="1">` +
      `<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>` +
      `<rect inkscape:label="bg" style="fill:url(#g);cursor:pointer;isolation:isolate" width="16" height="12"/>` +
      `<use xlink:href="#r" x="1"/><text xml:space="preserve" xml:lang="en">a &amp; b &lt; c &#x41;<![CDATA[ <d> ]]></text></svg>`;
    const out = checkedSvg(text);
    expect(out).toMatchObject({
      ok: true,
      svg:
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12">` +
        `<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>` +
        `<rect style="fill:url(#g);isolation:isolate" width="16" height="12"/>` +
        `<use href="#r" x="1"/><text xml:space="preserve">a &amp; b &lt; c A &lt;d&gt; </text></svg>`,
    });
  });

  it("reads its own output back to the same text", () => {
    const text = svg(
      `<g fill="#336699" transform="translate(1 2)"><path d="M0 0h4v4z"/><text x="1" font-family="system-ui, 'Segoe UI'">x &amp; y</text></g>` +
        `<filter id="f"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2"/></filter><rect filter="url(#f)"/>`,
    );
    const once = checkedSvg(text);
    expect(once.ok).toBe(true);
    if (once.ok) expect(checkedSvg(once.svg)).toEqual(once);
  });

  it("takes an SVG that declares no namespace, as librsvg does, and writes the namespace", () => {
    expect(checkedSvg('<svg width="10"><rect width="10"/></svg>')).toMatchObject({
      ok: true,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect width="10"/></svg>',
    });
    expect(reason('<svg width="10"><g xmlns="urn:x"/></svg>')).toMatch(/only SVG elements/);
  });

  it("keeps a prefixed SVG root and writes it without the prefix", () => {
    expect(checkedSvg('<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:rect width="1"/></s:svg>')).toMatchObject({
      ok: true,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/></svg>',
    });
  });
});
