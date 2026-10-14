// Entry point of the build worker, bundled to deploy/dist/worker.cjs by
// `npm run build:scripts` and run by pm2 next to the web app
// (deploy/ecosystem.config.cjs). Stops cleanly on SIGTERM/SIGINT.
import { startWorker } from "../lib/worker";

const stop = new AbortController();
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => stop.abort());
console.log(`worker: started (runner ${process.env.SANDBOX_RUNNER || "local"})`);
startWorker({ signal: stop.signal }).then(() => {
  console.log("worker: stopped");
  process.exit(0);
});
