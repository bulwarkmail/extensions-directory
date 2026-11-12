// An SVG whose root element comes after a long comment, as editors and license headers
// produce, is taken like any other.
import { expect, it } from "vitest";
import { encodeImage } from "./images";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const comment = `<!-- ${"Licensed under the Apache License, Version 2.0. ".repeat(30)} -->`;

it.each([
  ["a 1.5 KB license comment before the root", `<?xml version="1.0" encoding="UTF-8"?>\n${comment}\n<svg ${NS} width="16" height="12"><rect width="16" height="12" fill="#336699"/></svg>`],
  ["a short editor comment before the root", `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Created with Inkscape (http://www.inkscape.org/) -->\n<svg ${NS} width="16" height="12"><rect width="16" height="12" fill="#336699"/></svg>`],
])("takes an SVG with %s", async (_name, text) => {
  await expect(encodeImage(Buffer.from(text), "icon")).resolves.toMatchObject({ ext: "png" });
});
