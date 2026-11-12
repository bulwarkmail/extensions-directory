// What drawing an SVG may cost is bounded in the checked tree, before anything is drawn:
// elements, filter steps per filter, shapes drawn once use/clip-path/mask references are
// followed, filter steps run, and the canvas of a filtered SVG. Counts, not timings.
import { describe, expect, it } from "vitest";
import { encodeImage, MAX_FILTERED_SVG_PIXELS } from "./images";
import { checkedSvg, MAX_DRAWN, MAX_ELEMENTS, MAX_FILTER_PRIMITIVES, MAX_FILTER_RUNS } from "./svg";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (body: string, size = 64) => `<svg ${NS} width="${size}" height="${size}">${body}</svg>`;
const outcome = (text: string) => {
  const out = checkedSvg(text);
  return out.ok ? "drawn" : out.reason;
};
const filter = (steps: number) => `<filter id="f">${'<feFlood flood-color="#123456"/>'.repeat(steps)}</filter>`;

describe("the checked tree", () => {
  it("holds at most MAX_ELEMENTS elements, the root included", () => {
    expect(outcome(svg("<rect/>".repeat(MAX_ELEMENTS - 1)))).toBe("drawn");
    expect(outcome(svg("<rect/>".repeat(MAX_ELEMENTS)))).toMatch(/more than 2000 elements/);
  });

  it("holds at most MAX_FILTER_PRIMITIVES steps per filter", () => {
    expect(outcome(svg(`${filter(MAX_FILTER_PRIMITIVES)}<rect filter="url(#f)"/>`))).toBe("drawn");
    expect(outcome(svg(`${filter(MAX_FILTER_PRIMITIVES + 1)}<rect filter="url(#f)"/>`))).toMatch(/more than 8 steps/);
  });

  it("runs at most MAX_FILTER_RUNS filter steps, counting every filtered shape", () => {
    const shapes = (n: number) => '<rect filter="url(#f)"/>'.repeat(n);
    expect(outcome(svg(filter(MAX_FILTER_PRIMITIVES) + shapes(MAX_FILTER_RUNS / MAX_FILTER_PRIMITIVES)))).toBe("drawn");
    expect(outcome(svg(filter(MAX_FILTER_PRIMITIVES) + shapes(MAX_FILTER_RUNS / MAX_FILTER_PRIMITIVES + 1)))).toMatch(/more than 64 filter steps/);
    // A use of a filtered shape runs its filter again.
    expect(outcome(svg(`${filter(MAX_FILTER_PRIMITIVES)}<g id="g">${shapes(4)}</g>${'<use href="#g"/>'.repeat(4)}`))).toMatch(/filter steps/);
  });

  it("draws at most MAX_DRAWN shapes once use, clip-path and mask references are followed", () => {
    const group = (n: number) => `<g id="g">${"<rect/>".repeat(n)}</g>`;
    expect(outcome(svg(`<defs>${group(99)}</defs>${'<use href="#g"/>'.repeat(98)}`))).toBe("drawn");
    expect(outcome(svg(`<defs>${group(100)}</defs>${'<use href="#g"/>'.repeat(100)}`))).toMatch(/more than 10000 shapes/);
    expect(outcome(svg(`<defs><mask id="m">${"<rect/>".repeat(100)}</mask></defs>${'<rect mask="url(#m)"/>'.repeat(100)}`))).toMatch(/shapes/);
    expect(outcome(svg(`<defs><clipPath id="c">${"<rect/>".repeat(100)}</clipPath></defs>${'<rect style="clip-path:url(#c)"/>'.repeat(100)}`))).toMatch(/shapes/);
    expect(MAX_DRAWN).toBe(10_000);
  });

  it("refuses ten levels of ten uses each, which would draw 10^10 shapes", () => {
    let defs = '<rect id="l0" width="1" height="1"/>';
    for (let i = 1; i <= 10; i++) defs += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`;
    expect(outcome(svg(`<defs>${defs}</defs><use href="#l10"/>`, 512))).toMatch(/shapes/);
  });

  it("refuses references that form a loop", () => {
    expect(outcome(svg('<g id="a"><use href="#a"/></g>'))).toMatch(/loop/);
    expect(outcome(svg('<mask id="m"><rect mask="url(#m)"/></mask><rect mask="url(#m)"/>'))).toMatch(/loop/);
  });

  it("refuses a filter that keeps a hundred named results", () => {
    let steps = "";
    for (let i = 0; i < 100; i++) steps += `<feFlood flood-color="#${(i * 2).toString(16).padStart(2, "0")}0000" result="r${i}"/>`;
    expect(outcome(svg(`<defs><filter id="f">${steps}</filter></defs><rect width="1024" height="1024" filter="url(#f)"/>`, 1024))).toMatch(/steps/);
  });
});

describe("the canvas of an SVG, as librsvg reports it before drawing", () => {
  const big = (filtered: boolean) =>
    Buffer.from(`<svg ${NS} width="2100" height="2100">${filtered ? filter(1) : ""}<rect width="2100" height="2100" fill="#336699"${filtered ? ' filter="url(#f)"' : ""}/></svg>`);

  it("is at most 2048 x 2048 px when the SVG runs a filter", async () => {
    expect(2100 * 2100).toBeGreaterThan(MAX_FILTERED_SVG_PIXELS);
    await expect(encodeImage(big(true), "screenshot")).rejects.toThrow(/filters may cover at most 2048 x 2048/);
  });

  it("may be larger without a filter", async () => {
    await expect(encodeImage(big(false), "screenshot")).resolves.toMatchObject({ ext: "webp", width: 1920 });
  });
});
