// Decodes and re-encodes one author image for the worker, which starts this
// as a child process per image (lib/images.ts decodeInChildProcess). Bundled
// to deploy/dist/decode-image.cjs by `npm run build:scripts`. Its
// environment holds none of the worker's secrets. It gets the image over
// IPC, answers, and is stopped by the worker.
import { encodeImage, ImageError, type ChildReply, type ImageKind } from "../lib/images";

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
