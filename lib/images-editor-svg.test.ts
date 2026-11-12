// SVGs as drawing programs save them. What draws nothing is left out and the drawing goes on:
// <metadata>, elements of the program's own namespace with everything inside them, and
// attributes of other namespaces. What is taken draws byte for byte as sharp draws the saved
// file itself. What stays refused says what to change in the program's export.
//
// The fixtures are written by hand in the shape these programs save; no saved file is copied.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { encodeImage, ImageError, type ImageKind } from "./images";

const INKSCAPE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->
<svg width="64" height="64" viewBox="0 0 64 64" version="1.1" id="svg1"
   inkscape:version="1.3 (0e150ed6c4, 2023-07-21)" sodipodi:docname="icon.svg"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg"
   xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cc="http://creativecommons.org/ns#"
   xmlns:dc="http://purl.org/dc/elements/1.1/">
  <sodipodi:namedview id="namedview1" pagecolor="#ffffff" bordercolor="#000000" inkscape:zoom="8" inkscape:document-units="px"/>
  <defs id="defs1"/>
  <metadata id="metadata1"><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format></cc:Work></rdf:RDF></metadata>
  <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1">
    <rect style="fill:#336699;stroke:none" id="rect1" width="64" height="64" x="0" y="0"/>
  </g>
</svg>`;

it("takes an Inkscape SVG with metadata and sodipodi:namedview, drawing the same as without them", async () => {
  const out = await encodeImage(Buffer.from(INKSCAPE), "icon");
  const plain = await encodeImage(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g><rect style="fill:#336699;stroke:none" width="64" height="64" x="0" y="0"/></g></svg>`), "icon");
  expect(out.data.equals(plain.data)).toBe(true);
});

// The conversion encodeImage does, on the saved file as it is.
function drawDirectly(input: Buffer, kind: ImageKind): Promise<Buffer> {
  const pipeline = sharp(input, { limitInputPixels: 25_000_000, failOn: "error", animated: false }).rotate();
  if (kind === "icon") {
    return pipeline.resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
  }
  return pipeline.resize({ width: kind === "banner" ? 1600 : 1920, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
}

const INKSCAPE_092 = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->

<svg
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:cc="http://creativecommons.org/ns#"
   xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
   xmlns:svg="http://www.w3.org/2000/svg"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:xlink="http://www.w3.org/1999/xlink"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   width="256"
   height="256"
   viewBox="0 0 67.733332 67.733335"
   version="1.1"
   id="svg8"
   inkscape:version="0.92.4 (5da689c313, 2019-01-14)"
   sodipodi:docname="banner.svg">
  <defs
     id="defs2">
    <linearGradient
       inkscape:collect="always"
       id="linearGradient833">
      <stop
         style="stop-color:#3b82f6;stop-opacity:1"
         offset="0"
         id="stop829" />
      <stop
         style="stop-color:#1e40af;stop-opacity:1"
         offset="1"
         id="stop831" />
    </linearGradient>
    <linearGradient
       inkscape:collect="always"
       xlink:href="#linearGradient833"
       id="linearGradient835"
       x1="0"
       y1="0"
       x2="67.733"
       y2="67.733"
       gradientUnits="userSpaceOnUse" />
  </defs>
  <sodipodi:namedview
     id="base"
     pagecolor="#ffffff"
     inkscape:zoom="2.8"
     inkscape:current-layer="layer1"
     showgrid="false">
    <inkscape:grid
       type="xygrid"
       id="grid815" />
  </sodipodi:namedview>
  <metadata
     id="metadata5">
    <rdf:RDF>
      <cc:Work
         rdf:about="">
        <dc:format>image/svg+xml</dc:format>
        <dc:type
           rdf:resource="http://purl.org/dc/dcmitype/StillImage" />
        <dc:title></dc:title>
      </cc:Work>
    </rdf:RDF>
  </metadata>
  <g
     inkscape:label="Layer 1"
     inkscape:groupmode="layer"
     id="layer1">
    <rect
       style="opacity:1;fill:url(#linearGradient835);fill-opacity:1;stroke:none;stroke-width:0.26458332"
       id="rect817"
       width="67.733"
       height="67.733"
       x="0"
       y="0"
       ry="8" />
    <path
       sodipodi:nodetypes="ccc"
       inkscape:connector-curvature="0"
       id="path819"
       d="M 16,34 28,46 52,22"
       style="fill:none;stroke:#ffffff;stroke-width:6;stroke-linecap:round;stroke-linejoin:round;stroke-opacity:1" />
  </g>
</svg>
`;

const ILLUSTRATOR_PRESENTATION = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="linear-gradient" x1="0" y1="0" x2="256" y2="256" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#1e40af"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="32" ry="32" fill="url(#linear-gradient)"/>
  <circle cx="128" cy="128" r="64" fill="none" stroke="#fff" stroke-miterlimit="10" stroke-width="16"/>
</svg>`;

const FIGMA = `<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="256" height="256" rx="40" fill="#1E40AF"/>
<g filter="url(#filter0_d_12_7)">
<circle cx="128" cy="124" r="56" fill="white"/>
</g>
<defs>
<filter id="filter0_d_12_7" x="64" y="64" width="128" height="128" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="4"/>
<feGaussianBlur stdDeviation="4"/>
<feComposite in2="hardAlpha" operator="out"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_12_7"/>
<feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_12_7" result="shape"/>
</filter>
</defs>
</svg>
`;

const SKETCH = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="256px" height="256px" viewBox="0 0 256 256" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sketch="http://www.bohemiancoding.com/sketch/ns">
    <!-- Generator: Sketch 3.8.3 (29802) - http://www.bohemiancoding.com/sketch -->
    <title>icon</title>
    <desc>Created with Sketch.</desc>
    <defs>
        <rect id="path-1" x="0" y="0" width="256" height="256" rx="32"></rect>
    </defs>
    <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" sketch:type="MSPage">
        <g id="icon" sketch:type="MSArtboardGroup">
            <mask id="mask-2" fill="white">
                <use xlink:href="#path-1"></use>
            </mask>
            <use id="Rectangle" fill="#336699" sketch:type="MSShapeGroup" xlink:href="#path-1"></use>
            <circle id="Oval" fill="#FFFFFF" mask="url(#mask-2)" cx="256" cy="256" r="128"></circle>
        </g>
    </g>
</svg>`;

describe("files saved by drawing programs", () => {
  it.each([
    ["Inkscape 0.92 (metadata, sodipodi:namedview with an inkscape:grid, xlink gradient)", INKSCAPE_092],
    ["Inkscape 1.3 (metadata, sodipodi:namedview)", INKSCAPE],
    ["Illustrator, Export As > SVG with presentation attributes", ILLUSTRATOR_PRESENTATION],
    ["Figma (a drop shadow filter)", FIGMA],
    ["Sketch (title, desc, sketch: attributes, mask with use)", SKETCH],
  ])("takes %s and draws it as sharp draws the saved file", async (_name, text) => {
    for (const kind of ["icon", "banner"] as const) {
      const out = await encodeImage(Buffer.from(text), kind);
      expect(out.data.equals(await drawDirectly(Buffer.from(text), kind))).toBe(true);
    }
  });

  it.each([
    [
      "Illustrator, Export As > SVG with internal CSS",
      `<svg id="Layer_1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><style>.cls-1{fill:#1e40af;}</style></defs><rect class="cls-1" width="256" height="256"/></svg>`,
      /<style> element, which isn't accepted: export the styles as presentation attributes \(Illustrator: Export As > SVG, Styling "Presentation Attributes"\)/,
    ],
    [
      "Illustrator, Save As SVG",
      `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n` +
        `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 256 256" style="enable-background:new 0 0 256 256;" xml:space="preserve">\n` +
        `<style type="text/css">\n\t.st0{fill:#1E40AF;}\n</style>\n<rect class="st0" width="256" height="256"/>\n</svg>`,
      /<style> element.*Presentation Attributes/,
    ],
    [
      "Illustrator, Save As SVG with a DOCTYPE",
      `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n` +
        `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect fill="#1E40AF" width="256" height="256"/></svg>`,
      /DOCTYPE.*Export As > SVG doesn't/,
    ],
    [
      "Illustrator, Save As SVG with editing capabilities kept",
      `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/" viewBox="0 0 256 256">` +
        `<switch><foreignObject requiredExtensions="http://ns.adobe.com/AdobeIllustrator/10.0/" x="0" y="0" width="1" height="1"><i:pgfRef xlink:href="#adobe_illustrator_pgf" xmlns:xlink="http://www.w3.org/1999/xlink"/></foreignObject>` +
        `<g i:extraneous="self"><rect fill="#1E40AF" width="256" height="256"/></g></switch>` +
        `<i:pgf id="adobe_illustrator_pgf">eJzLSM3JyVcozy/KSQEAGgsEXQ==</i:pgf></svg>`,
      /<switch>.*"Preserve Illustrator Editing Capabilities"/,
    ],
    [
      "an embedded picture",
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="256" height="256"><image width="256" height="256" xlink:href="data:image/png;base64,iVBORw0KGgo="/></svg>`,
      /embedded or linked images aren't accepted in an SVG. Send the picture as a PNG, JPEG or WebP file/,
    ],
  ])("refuses %s and says what to change", async (_name, text, advice) => {
    const err = await encodeImage(Buffer.from(text), "icon").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageError);
    expect((err as Error).message).toMatch(advice);
  });

  it("draws nothing that sits inside an element of another namespace, SVG elements included", async () => {
    const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#336699"/>` +
      `<x:layer xmlns:x="urn:x"><rect width="64" height="64" fill="#ff0000"/><g xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" fill="#ff0000"/></g></x:layer></svg>`;
    const plain = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#336699"/></svg>`;
    const out = await encodeImage(Buffer.from(wrapped), "icon");
    expect(out.data.equals((await encodeImage(Buffer.from(plain), "icon")).data)).toBe(true);
  });
});
