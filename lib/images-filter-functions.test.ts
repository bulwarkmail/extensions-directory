// librsvg 2.63 applies CSS filter functions (blur(), drop-shadow(), hue-rotate(), ...) given in
// the filter property, as an attribute or in style. They would run filter steps like <filter>
// elements do, past the limits on filter steps and on the canvas of a filtered SVG, so the
// filter property takes only url(#id) or none.
import { describe, expect, it } from "vitest";
import { encodeImage, ImageError } from "./images";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const refusal = (svg: string, kind: "icon" | "screenshot" = "screenshot") =>
  encodeImage(Buffer.from(svg), kind).then(
    () => "accepted",
    (e: unknown) => (e instanceof ImageError ? "refused" : `error: ${String(e)}`)
  );

describe("CSS filter functions count against the filter limits", () => {
  it("refuses 65 filter functions on one shape (more than 64 filter steps)", async () => {
    const svg = `<svg ${NS} width="64" height="64"><rect width="64" height="64" fill="#336699" filter="${Array(65).fill("blur(1px)").join(" ")}"/></svg>`;
    expect(await refusal(svg)).toBe("refused");
  });

  it("refuses 65 shapes with one filter function each", async () => {
    const shapes = Array.from({ length: 65 }, () => '<rect width="64" height="64" fill="#336699" style="filter:drop-shadow(1px 1px 0 #000)"/>').join("");
    expect(await refusal(`<svg ${NS} width="64" height="64">${shapes}</svg>`)).toBe("refused");
  });

  it("refuses a filtered SVG larger than 2048 x 2048, also when the filter is a function", async () => {
    const svg = `<svg ${NS} width="4096" height="4096"><rect width="4096" height="4096" fill="#336699" filter="blur(1px)"/></svg>`;
    expect(await refusal(svg)).toBe("refused");
  });

  it("still takes the same drawing with a url(#id) filter of one step at 2048 px (control)", async () => {
    const svg = `<svg ${NS} width="2048" height="2048"><filter id="f"><feGaussianBlur stdDeviation="1"/></filter><rect width="2048" height="2048" fill="#336699" filter="url(#f)"/></svg>`;
    expect(await refusal(svg)).toBe("accepted");
  });
});
