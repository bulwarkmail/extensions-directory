// SVGs that would make librsvg read a second document (XInclude, url() and href to data:
// URLs, xml-stylesheet, CSS @import), and files whose body doesn't match their signature.
//
// Every nested document below is harmless: one entity that holds a colour (red). If the
// outer SVG came out red, librsvg would have parsed a DOCTYPE with an entity that was never checked.
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { encodeImage, ImageError } from "./images";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

const RED_RECT = `<?xml version="1.0"?><!DOCTYPE rect [<!ENTITY c "#ff0000">]><rect ${NS} width="16" height="12" fill="&c;"/>`;
const RED_DOC =
  `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY c "#ff0000">]>` +
  `<svg ${NS} width="16" height="12"><defs><linearGradient id="g"><stop offset="0" stop-color="&c;"/><stop offset="1" stop-color="&c;"/></linearGradient>` +
  `<filter id="f"><feFlood flood-color="&c;"/></filter></defs><rect id="r" width="16" height="12" fill="&c;"/></svg>`;

async function centre(out: Buffer): Promise<number[]> {
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return [...data.subarray(i, i + info.channels)];
}

// Resolves to "refused: <message>" or "rendered: r,g,b,a" so a failure names what happened.
async function outcome(svg: string): Promise<string> {
  try {
    const out = await encodeImage(Buffer.from(svg, "utf8"), "icon");
    return `rendered: ${(await centre(out.data)).join(",")}`;
  } catch (err) {
    if (err instanceof ImageError) return `refused: ${err.message}`;
    throw err;
  }
}

const isRed = (o: string) => /^rendered: 2(4\d|5[0-5]),\d{1,2},\d{1,2},255$/.test(o);

describe("an SVG that pulls in a second document the text checks never saw", () => {
  it.each([
    [
      "an XInclude of a data: URL labelled image/png",
      `<svg ${NS} xmlns:xi="http://www.w3.org/2001/XInclude" width="16" height="12"><xi:include href="data:image/png;base64,${b64(RED_RECT)}" parse="xml"/></svg>`,
    ],
    [
      "a fill that references an element in a data:image/svg+xml document",
      `<svg ${NS} width="16" height="12"><rect width="16" height="12" fill="url(data:image/svg+xml;base64,${b64(RED_DOC)}#g)"/></svg>`,
    ],
    [
      "a filter that references an element in a data:image/svg+xml document",
      `<svg ${NS} width="16" height="12"><rect width="16" height="12" fill="#336699" filter="url(data:image/svg+xml;base64,${b64(RED_DOC)}#f)"/></svg>`,
    ],
    [
      "a use that references an element in a data: document labelled image/png",
      `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" width="16" height="12"><use xlink:href="data:image/png;base64,${b64(RED_DOC)}#r"/></svg>`,
    ],
    [
      "an image whose data: URL labelled image/png holds an SVG",
      `<svg ${NS} width="16" height="12"><image width="16" height="12" href="data:image/png;base64,${b64(RED_DOC)}"/></svg>`,
    ],
  ])("is refused or comes out without the entity: %s", async (_name, svg) => {
    const o = await outcome(svg);
    expect(isRed(o), o).toBe(false);
  });

  it("is refused or comes out without the entity: an XInclude nested inside an XInclude", async () => {
    const inner = `<?xml version="1.0"?><!DOCTYPE rect [<!ENTITY c "#ff0000">]><rect ${NS} width="16" height="12" fill="&c;"/>`;
    const middle = `<g ${NS} xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="data:image/png;base64,${b64(inner)}" parse="xml"/></g>`;
    const svg = `<svg ${NS} xmlns:xi="http://www.w3.org/2001/XInclude" width="16" height="12"><xi:include href="data:image/gif;base64,${b64(middle)}" parse="xml"/></svg>`;
    const o = await outcome(svg);
    expect(isRed(o), o).toBe(false);
  });

  it("is refused or comes out without the entity: an XInclude of a document in UTF-16", async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(RED_RECT.replace('<?xml version="1.0"?>', '<?xml version="1.0" encoding="UTF-16"?>'), "utf16le")]);
    const svg = `<svg ${NS} xmlns:xi="http://www.w3.org/2001/XInclude" width="16" height="12"><xi:include href="data:image/webp;base64,${b64(utf16)}" parse="xml"/></svg>`;
    const o = await outcome(svg);
    expect(isRed(o), o).toBe(false);
  });

  it("refuses a stylesheet that the text checks never saw: xml-stylesheet with a data: URL labelled image/png", async () => {
    const css = b64("rect{fill:#ff0000 !important}");
    const svg = `<?xml version="1.0"?><?xml-stylesheet type="text/css" href="data:image/png;base64,${css}"?><svg ${NS} width="16" height="12"><rect width="16" height="12" fill="#336699"/></svg>`;
    const o = await outcome(svg);
    expect(isRed(o), o).toBe(false);
  });

  it("refuses an @import spelled with a CSS escape", async () => {
    const svg =
      `<svg ${NS} width="16" height="12"><style>@\\69mport "data:text/css;base64,${b64("rect{fill:#ff0000 !important}")}";</style>` +
      `<rect width="16" height="12" fill="#336699"/></svg>`;
    const o = await outcome(svg);
    expect(isRed(o), o).toBe(false);
  });
});

describe("a file whose first bytes name one format and whose body is another", () => {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pixels = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } });
  it.each([
    ["PNG signature, TIFF body", async () => Buffer.concat([PNG_SIG, await pixels().tiff().toBuffer()])],
    ["PNG signature, AVIF body", async () => Buffer.concat([PNG_SIG, await pixels().avif().toBuffer()])],
    ["PNG signature, SVG text", async () => Buffer.concat([PNG_SIG, Buffer.from(RED_DOC)])],
    ["GIF signature, PNG body", async () => Buffer.concat([Buffer.from("GIF89a"), await pixels().png().toBuffer()])],
    ["JPEG signature, TIFF body", async () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), await pixels().tiff().toBuffer()])],
    ["RIFF/WEBP header, SVG body", async () => Buffer.concat([Buffer.from("RIFF\x10\x00\x00\x00WEBP", "latin1"), Buffer.from(RED_DOC)])],
  ])("is refused: %s", async (_name, make) => {
    await expect(encodeImage(await make(), "icon")).rejects.toBeInstanceOf(ImageError);
  });
});

describe("size limits from the header", () => {
  it("decodes a GIF whose logical screen says 65535 x 65535 at its frame size, not the screen size", async () => {
    const gif = await pixels8().gif().toBuffer();
    const big = Buffer.from(gif);
    big.writeUInt16LE(65535, 6);
    big.writeUInt16LE(65535, 8);
    const out = await encodeImage(big, "screenshot").catch((e: unknown) => e);
    if (!(out instanceof ImageError)) expect([(out as { width: number }).width, (out as { height: number }).height]).toEqual([8, 8]);
  });

  it("refuses a PNG whose header says 100000 x 100000", async () => {
    const png = await pixels8().png().toBuffer();
    const big = Buffer.from(png);
    big.writeUInt32BE(100000, 16);
    big.writeUInt32BE(100000, 20);
    // the IHDR CRC is now wrong; fix it so only the size is at stake
    big.writeUInt32BE(crc32(big.subarray(12, 29)), 29);
    await expect(encodeImage(big, "screenshot")).rejects.toBeInstanceOf(ImageError);
  });

  it("refuses an SVG wider than 4096 px and takes one of exactly 4096", async () => {
    const svg = (w: number) => Buffer.from(`<svg ${NS} width="${w}" height="16"><rect width="${w}" height="16" fill="#336699"/></svg>`);
    await expect(encodeImage(svg(4097), "icon")).rejects.toThrow(/larger than 4096/);
    await expect(encodeImage(svg(4096), "icon")).resolves.toMatchObject({ ext: "png" });
  });
});

function pixels8() {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } });
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
