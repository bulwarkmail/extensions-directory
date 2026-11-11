// Entry point of the build worker, bundled to deploy/dist/worker.cjs by
// `npm run build:scripts` and run by pm2 next to the web app
// (deploy/ecosystem.config.cjs). Stops cleanly on SIGTERM/SIGINT.
import path from "path";
import { decodeInChildProcess } from "../lib/images";
import { startWorker } from "../lib/worker";

// Same as the web app (instrumentation.ts): files stay group-writable.
process.umask(0o007);

// Author images are decoded in a child process per image, from the bundle
// next to this one (deploy/dist/decode-image.cjs), without the worker's
// secrets in its environment.
decodeInChildProcess(path.join(__dirname, "decode-image.cjs"));

const stop = new AbortController();
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => stop.abort());
console.log(`worker: started (runner ${process.env.SANDBOX_RUNNER || "local"})`);
startWorker({ signal: stop.signal }).then(() => {
  console.log("worker: stopped");
  process.exit(0);
});
