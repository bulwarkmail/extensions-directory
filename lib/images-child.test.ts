// In the worker, encodeImage decodes in a child process per image
// (decodeInChildProcess): the child sees none of the worker's secrets, gets
// only bytes that passed the checks in the worker, and a child that fails
// costs one image, not the worker.
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { build } from "esbuild";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { decodeInChildProcess, encodeImage, ImageError } from "./images";

const SECRETS = [
  "SIGNING_KEY_FILE",
  "SMTP_PASSWORD",
  "SANDBOX_SSH_KEY",
  "AUTHOR_SESSION_SECRET",
  "ADMIN_SESSION_SECRET",
  "TOKEN_PEPPER",
  "GITHUB_CLIENT_SECRET",
];
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="#336699"/></svg>';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "decode-image-"));
function stub(name: string, code: string): string {
  const file = path.join(scratch, name);
  fs.writeFileSync(file, code);
  return file;
}
const png = () => sharp({ create: { width: 8, height: 8, channels: 4, background: "#db2d54" } }).png().toBuffer();

// The real child, bundled as build:scripts does, where it finds sharp.
const child = path.resolve("node_modules/.cache/decode-image-test/decode-image.cjs");
beforeAll(async () => {
  await build({ entryPoints: ["worker/decode-image.ts"], bundle: true, platform: "node", format: "cjs", external: ["sharp"], outfile: child, logLevel: "warning" });
});
afterEach(() => decodeInChildProcess(null));

describe("decoding in a child process", () => {
  it("starts the child without the worker's secrets", async () => {
    for (const key of SECRETS) process.env[key] = "fake-value-for-the-test";
    try {
      decodeInChildProcess(stub("env.cjs", `process.on("message", () => process.send({ error: JSON.stringify(Object.keys(process.env)), imageError: true }));`));
      const err = await encodeImage(await png(), "icon").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ImageError);
      const seen = JSON.parse((err as Error).message) as string[];
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.filter((key) => SECRETS.includes(key))).toEqual([]);
    } finally {
      for (const key of SECRETS) delete process.env[key];
    }
  });

  it("checks the bytes before it starts the child", async () => {
    decodeInChildProcess(stub("ran.cjs", `process.on("message", () => process.send({ error: "the child ran", imageError: true }));`));
    const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#db2d54" } }).tiff().toBuffer();
    await expect(encodeImage(tiff, "icon")).rejects.toThrow(/Unsupported image type tiff/);
    await expect(encodeImage(zlib.gzipSync(Buffer.from(SVG)), "icon")).rejects.toThrow(/Unsupported image type gzip/);
    await expect(encodeImage(Buffer.from(SVG), "icon")).rejects.toThrow(/the child ran/);
  });

  it("gives the same result as decoding in-process", async () => {
    const input = await png();
    const here = [await encodeImage(input, "icon"), await encodeImage(Buffer.from(SVG), "screenshot")];
    decodeInChildProcess(child);
    const there = [await encodeImage(input, "icon"), await encodeImage(Buffer.from(SVG), "screenshot")];
    expect(there).toEqual(here);
  });

  it("passes the decoder's refusal on", async () => {
    decodeInChildProcess(child);
    await expect(encodeImage((await png()).subarray(0, 40), "icon")).rejects.toBeInstanceOf(ImageError);
  });

  it("refuses the image when the child stops", async () => {
    decodeInChildProcess(stub("exit.cjs", `process.on("message", () => process.exit(70));`));
    await expect(encodeImage(await png(), "icon")).rejects.toThrow(/the decoder stopped/);
  });

  it.each([
    ["another format", `{ image: { data: Buffer.from("<p>not a png</p>"), ext: "png", contentType: "image/png", width: 1, height: 1, hash: "000000000000" } }`],
    ["no image at all", `null`],
  ])("refuses an answer with %s", async (_name, reply) => {
    decodeInChildProcess(stub("wrong.cjs", `process.on("message", () => process.send(${reply}));`));
    await expect(encodeImage(await png(), "icon")).rejects.toBeInstanceOf(ImageError);
  });
});
