// Builds an extension from source in a sandbox: `npm ci --ignore-scripts`
// with network (registry only, enforced by the build VM's firewall), then
// `npm run build` with no network. Two runners:
//
//   ssh    the separate build VM (production): source goes over SSH as a tar
//          on stdin, the built tree comes back as a tar on stdout. See
//          deploy/build-vm/.
//   local  Docker on this machine (development).
//
// The runner returns the whole tree after the build (without node_modules);
// pickOutput() then takes the directory holding the entrypoint.
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { pack, unpack } from "./tar";
import { MAX_BUNDLE_FILES, SOURCE_DIRS, shouldSkip } from "@/lib/bundle-rules";

export const MAX_SOURCE_FILES = 5000;
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_TREE_BYTES = 200 * 1024 * 1024;
const MAX_LOG = 16_000;

export class BuildError extends Error {
  constructor(message: string, readonly log = "") {
    super(message);
  }
}

export interface RunnerResult {
  tree: Map<string, Uint8Array>;
  log: string;
  /** The build image, by digest when the runner knows it. */
  image: string;
}

export interface Runner {
  name: string;
  build(source: Map<string, Uint8Array>): Promise<RunnerResult>;
}

function tail(s: string): string {
  const clean = s.replace(/\x1b\[[0-9;]*m/g, "").trim();
  return clean.length > MAX_LOG ? `…${clean.slice(-MAX_LOG)}` : clean;
}

function spawnCollect(cmd: string, args: string[], opts: { stdin?: Buffer; timeoutMs: number; maxStdout: number; onTimeout?: () => void }) {
  return new Promise<{ code: number | null; stdout: Buffer; stderr: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = "";
    let timedOut = false;
    let overflow = false;
    child.stdout.on("data", (c: Buffer) => {
      outBytes += c.length;
      if (outBytes > opts.maxStdout) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      out.push(c);
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString("utf8");
      if (err.length > MAX_LOG * 4) err = err.slice(-MAX_LOG * 2);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      opts.onTimeout?.();
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (overflow) reject(new BuildError("Build output is too large"));
      else resolve({ code, stdout: Buffer.concat(out), stderr: err, timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(opts.stdin ?? Buffer.alloc(0));
  });
}

// ── ssh: the build VM ─────────────────────────────────────────────────────────
// The forced command on the VM (deploy/build-vm/extbuild) answers with exit
// codes: 0 built, 10 install failed, 11 build failed, 12 timed out, other: VM
// trouble. Its first stderr line is "image <digest>".
export function sshRunner(): Runner {
  const host = process.env.SANDBOX_SSH_HOST;
  const key = process.env.SANDBOX_SSH_KEY;
  const knownHosts = process.env.SANDBOX_SSH_KNOWN_HOSTS;
  if (!host || !key || !knownHosts) throw new Error("SANDBOX_SSH_HOST, SANDBOX_SSH_KEY and SANDBOX_SSH_KNOWN_HOSTS must be set");
  return {
    name: "ssh",
    async build(source) {
      const res = await spawnCollect("ssh", [
        "-i", key, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", `UserKnownHostsFile=${knownHosts}`, "-o", "ConnectTimeout=15", host, "build",
      ], { stdin: pack(source), timeoutMs: 15 * 60_000, maxStdout: MAX_TREE_BYTES });
      const [first, ...rest] = res.stderr.split("\n");
      const image = first.startsWith("image ") ? first.slice(6).trim() : "unknown";
      const log = tail(first.startsWith("image ") ? rest.join("\n") : res.stderr);
      if (res.timedOut || res.code === 12) throw new BuildError("The build took too long and was stopped.", log);
      if (res.code === 10) throw new BuildError("Installing dependencies failed (npm ci --ignore-scripts). If package-lock.json is out of date, run npm install and commit it.", log);
      if (res.code === 11) throw new BuildError("npm run build failed. The build runs without network access.", log);
      if (res.code !== 0) throw new BuildError(`The build machine failed (exit ${res.code}); try again later.`, log);
      return { tree: unpack(res.stdout, { maxFiles: MAX_SOURCE_FILES * 4, maxBytes: MAX_TREE_BYTES }), log, image };
    },
  };
}

// ── local Docker ──────────────────────────────────────────────────────────────
export function localDockerRunner(): Runner {
  const image = process.env.SANDBOX_BUILD_IMAGE || "node:22-alpine";
  const memory = process.env.SANDBOX_BUILD_MEMORY || "1g";
  const tmpRoot = process.env.SANDBOX_BUILD_TMP || path.join(process.cwd(), "data", "tmp-builds");
  const phaseTimeout = Number(process.env.SANDBOX_BUILD_TIMEOUT_MS) || 240_000;

  const docker = (dir: string, name: string, network: "bridge" | "none", command: string) =>
    spawnCollect("docker", [
      "run", "--rm", "--name", name, "--network", network, "--memory", memory, "--memory-swap", memory,
      "--cpus", process.env.SANDBOX_BUILD_CPUS || "1", "--pids-limit", "512", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp:rw,noexec,size=64m",
      "--user", "1000:1000", "-v", `${dir}:/build`, "-w", "/build", "-e", "HOME=/build",
      "-e", "npm_config_cache=/build/.npm-cache", "-e", "CI=true", image, "sh", "-c", command,
    ], { timeoutMs: phaseTimeout, maxStdout: 1024 * 1024, onTimeout: () => void spawnCollect("docker", ["kill", name], { timeoutMs: 10_000, maxStdout: 1024 }).catch(() => {}) });

  return {
    name: "local",
    async build(source) {
      await fs.mkdir(tmpRoot, { recursive: true });
      const dir = await fs.mkdtemp(path.join(tmpRoot, "build-"));
      const id = crypto.randomBytes(6).toString("hex");
      try {
        for (const [rel, data] of source) {
          const dest = path.join(dir, rel);
          await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o777 });
          await fs.writeFile(dest, data, { mode: 0o666 });
        }
        await fs.chmod(dir, 0o777).catch(() => {});
        const install = source.has("package-lock.json") ? "npm ci --ignore-scripts --no-audit --no-fund" : "npm install --ignore-scripts --no-audit --no-fund";
        const i = await docker(dir, `extbuild-${id}-i`, "bridge", install);
        let log = `$ ${install}\n${i.stdout}${i.stderr}`;
        if (i.timedOut) throw new BuildError("Installing dependencies took too long.", tail(log));
        if (i.code !== 0) throw new BuildError("Installing dependencies failed (npm ci --ignore-scripts). If package-lock.json is out of date, run npm install and commit it.", tail(log));
        const b = await docker(dir, `extbuild-${id}-b`, "none", "npm run build");
        log += `\n$ npm run build\n${b.stdout}${b.stderr}`;
        if (b.timedOut) throw new BuildError("The build took too long and was stopped.", tail(log));
        if (b.code !== 0) throw new BuildError("npm run build failed. The build runs without network access.", tail(log));
        return { tree: await readTree(dir), log: tail(log), image };
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

async function readTree(root: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  async function walk(dir: string, prefix: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".npm-cache" || e.name === ".git") continue;
        await walk(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        // Symlinks are never followed: a build could point one at a host file.
        const data = await fs.readFile(path.join(dir, e.name));
        total += data.length;
        if (total > MAX_TREE_BYTES) throw new BuildError("Build output is too large");
        files.set(rel, new Uint8Array(data));
      }
    }
  }
  await walk(root, "");
  return files;
}

let runnerOverride: Runner | null = null;
/** Tests use a fake runner. */
export function setRunner(r: Runner | null): void {
  runnerOverride = r;
}

export function getRunner(): Runner | null {
  if (runnerOverride) return runnerOverride;
  const kind = process.env.SANDBOX_RUNNER || "local";
  if (kind === "off") return null;
  return kind === "ssh" ? sshRunner() : localDockerRunner();
}

/**
 * From the tree after a build, the files that make up the bundle: everything
 * in the first of dist/, build/ or the root that holds the entrypoint, minus
 * sources, lock files and tests. manifest.json comes from the source.
 */
export function pickOutput(tree: Map<string, Uint8Array>, expected: string, manifest: Uint8Array): { files: Map<string, Uint8Array>; outDir: string } {
  for (const dir of ["dist", "build", ""]) {
    const key = dir ? `${dir}/${expected}` : expected;
    if (!tree.has(key)) continue;
    const files = new Map<string, Uint8Array>([["manifest.json", manifest]]);
    for (const [p, data] of tree) {
      if (dir && !p.startsWith(`${dir}/`)) continue;
      const rel = dir ? p.slice(dir.length + 1) : p;
      if (rel === "manifest.json") continue;
      if (!dir) {
        const top = rel.split("/")[0];
        if (SOURCE_DIRS.includes(`${top}/`) || top === "dist" || top === "build" || top === "package.json" || top === "media") continue;
      }
      if (shouldSkip(rel)) continue;
      files.set(rel, data);
      if (files.size > MAX_BUNDLE_FILES) throw new BuildError(`Build output has more than ${MAX_BUNDLE_FILES} files`);
    }
    return { files, outDir: dir };
  }
  throw new BuildError(`npm run build finished, but ${expected} is not in dist/, build/ or the plugin folder. Make the build write the entrypoint named in manifest.json.`);
}
