const { spawn } = require("child_process");
const path = require("path");
const dir = path.resolve(__dirname, "..");
const bin = path.join(
  dir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next",
);

const child = spawn(bin, ["dev", "--port", "3001"], {
  stdio: "inherit",
  cwd: dir,
});

child.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
