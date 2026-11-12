// Decodes and re-encodes one author image for the worker, which starts this
// as a child process per image (lib/images.ts decodeInChildProcess). Bundled
// to deploy/dist/decode-image.cjs by `npm run build:scripts`. Its
// environment holds none of the worker's secrets, and on Linux its address
// space is limited. It gets the image over IPC, answers, and is stopped by
// the worker.
import sharp from "sharp";
import { encodeImage, ImageError, type ChildReply, type ImageKind } from "../lib/images";

// One image at a time, on one libvips thread: what the child reserves stays
// the same on any host (lib/images.ts CHILD_ADDRESS_SPACE_MB).
sharp.concurrency(1);
sharp.cache(false);

process.on("disconnect", () => process.exit(0));
process.once("message", async ({ input, kind }: { input: Uint8Array; kind: ImageKind }) => {
  let reply: ChildReply;
  try {
    reply = { image: await encodeImage(Buffer.from(input.buffer, input.byteOffset, input.byteLength), kind) };
  } catch (err) {
    reply = { error: err instanceof Error ? err.message : String(err), imageError: err instanceof ImageError };
  }
  process.send?.(reply);
});
