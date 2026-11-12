// The decoder child's address-space limit, which the worker gets on Linux. A child that
// runs past it stops, the image is refused, the worker carries on and no child is left.
import fs from "fs";
import os from "os";
import path from "path";
import { build } from "esbuild";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CHILD_ADDRESS_SPACE_MB, decodeInChildProcess, encodeImage, ImageError } from "./images";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "decode-memory-"));
function stub(name: string, code: string): string {
  const file = path.join(scratch, name);
  fs.writeFileSync(file, code);
  return file;
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const child = path.resolve("node_modules/.cache/decode-memory-test/decode-image.cjs");
afterEach(() => decodeInChildProcess(null));

describe.skipIf(process.platform !== "linux")("the decoder child on Linux (skipped elsewhere: the limit is set with the shell's ulimit on Linux only)", () => {
  beforeAll(async () => {
    await build({ entryPoints: ["worker/decode-image.ts"], bundle: true, platform: "node", format: "cjs", external: ["sharp"], outfile: child, logLevel: "warning" });
  });

  it("starts with the address-space limit", async () => {
    decodeInChildProcess(
      stub("limits.cjs", `process.on("message", () => process.send({ error: require("fs").readFileSync("/proc/self/limits", "utf8"), imageError: true }));`),
    );
    const err = (await encodeImage(PNG, "icon").catch((e: unknown) => e)) as Error;
    const line = err.message.split("\n").find((l) => l.startsWith("Max address space"));
    expect(line?.split(/\s{2,}/)[1]).toBe(String(CHILD_ADDRESS_SPACE_MB * 1024 * 1024));
  });

  it("refuses the image when the child runs past the limit, and leaves no child behind", async () => {
    const pidFile = path.join(scratch, "alloc.pid");
    // Stops by itself at 4 GB, so a child without the limit can't take the machine's memory.
    decodeInChildProcess(
      stub(
        "alloc.cjs",
        `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
         process.on("message", () => { const keep = []; for (let i = 0; i < 64; i++) keep.push(Buffer.alloc(64 * 1024 * 1024, 1));
           process.send({ error: "allocated 4 GB without being stopped", imageError: true }); });`,
      ),
    );
    const err = await encodeImage(PNG, "icon").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageError);
    expect((err as Error).message).toMatch(/the decoder stopped/);
    expect(alive(Number(fs.readFileSync(pidFile, "utf8")))).toBe(false);
  });

  it("decodes an official-size banner with a filter within the limit", async () => {
    const banner =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" width="1200" height="675"><defs>` +
      `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1e40af"/></linearGradient>` +
      `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" stitchTiles="stitch"/>` +
      `<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.06 0"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs>` +
      `<rect width="1200" height="675" fill="url(#bg)"/><rect width="1200" height="675" filter="url(#grain)"/></svg>`;
    decodeInChildProcess(child);
    await expect(encodeImage(Buffer.from(banner), "banner")).resolves.toMatchObject({ ext: "webp", width: 1200, height: 675 });
  });
});
