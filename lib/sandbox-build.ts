import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import JSZip from "jszip";
import type { NormalizedManifest, ResolvedBundle } from "./manifest";
import { MAX_BUNDLE_FILES, SOURCE_DIRS, shouldSkip } from "./bundle-rules";

// Server-side sandboxed builds. When a submitted plugin has no committed
// artifacts but declares a "build" script in package.json, we extract its
// source to a temp dir and build it inside a locked-down Docker container:
//
//   phase 1  npm ci / npm install   — network on, so the registry is reachable
//   phase 2  npm run build          — network OFF (--network none)
//
// Both phases run as an unprivileged user with all capabilities dropped, a
// read-only root filesystem, and hard memory / CPU / pid / time limits. Only
// the plugin's own temp dir is mounted. Results are cached by a content hash
// of the source tree, so the submit-time scan and the approval-time publish
// don't build twice.

const ENABLED = process.env.SANDBOX_BUILD !== "0";
const IMAGE = process.env.SANDBOX_BUILD_IMAGE || "node:22-alpine";
const PHASE_TIMEOUT_MS = Number(process.env.SANDBOX_BUILD_TIMEOUT_MS) || 240_000;
const MEMORY = process.env.SANDBOX_BUILD_MEMORY || "1g";
const CPUS = process.env.SANDBOX_BUILD_CPUS || "1";

const MAX_SOURCE_FILES = 5000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024; // 64 MB extracted source
const MAX_OUTPUT_BYTES = 30 * 1024 * 1024; // 30 MB uncompressed build output
const MAX_LOG_TAIL = 4000; // chars of build log surfaced in errors
const MAX_CACHE_ENTRIES = 30;

const TMP_ROOT =
  process.env.SANDBOX_BUILD_TMP ||
  path.join(process.cwd(), "data", "tmp-builds");
const CACHE_DIR =
  process.env.SANDBOX_BUILD_CACHE ||
  path.join(process.cwd(), "data", "build-cache");

// ── docker availability (checked once per process) ───────────────────────────

let dockerCheck: Promise<boolean> | null = null;

function dockerAvailable(): Promise<boolean> {
  if (!dockerCheck) {
    dockerCheck = runCommand(
      "docker",
      ["version", "--format", "{{.Server.Version}}"],
      10_000
    )
      .then((r) => r.code === 0)
      .catch(() => false);
  }
  return dockerCheck;
}

// ── serialize builds (small host: 2 cores / 4 GB) ────────────────────────────

let buildQueue: Promise<unknown> = Promise.resolve();

function withBuildLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = buildQueue.then(fn, fn);
  buildQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

// ── child process helper ─────────────────────────────────────────────────────

interface RunResult {
  code: number | null;
  timedOut: boolean;
  /** Interleaved stdout+stderr, tail only. */
  output: string;
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
  onTimeout?: () => void
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > MAX_LOG_TAIL * 4) {
        output = output.slice(-MAX_LOG_TAIL * 2);
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer = setTimeout(() => {
      timedOut = true;
      onTimeout?.();
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, output });
    });
  });
}

function logTail(output: string): string {
  // Strip ANSI escapes and trim to a readable tail.
  const clean = output.replace(/\[[0-9;]*m/g, "").trim();
  return clean.length > MAX_LOG_TAIL ? `…${clean.slice(-MAX_LOG_TAIL)}` : clean;
}

// ── docker invocation ────────────────────────────────────────────────────────

async function runInContainer(opts: {
  name: string;
  dir: string;
  network: "bridge" | "none";
  command: string;
  timeoutMs: number;
}): Promise<RunResult> {
  const args = [
    "run",
    "--rm",
    "--name",
    opts.name,
    "--network",
    opts.network,
    "--memory",
    MEMORY,
    "--memory-swap",
    MEMORY,
    "--cpus",
    CPUS,
    "--pids-limit",
    "512",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,size=64m",
    "--user",
    "1000:1000",
    "-v",
    `${opts.dir}:/build`,
    "-w",
    "/build",
    "-e",
    "HOME=/build",
    "-e",
    "npm_config_cache=/build/.npm-cache",
    "-e",
    "CI=true",
    IMAGE,
    "sh",
    "-lc",
    opts.command,
  ];
  return runCommand("docker", args, opts.timeoutMs, () => {
    // --rm containers linger if the CLI is SIGKILLed; kill the container too.
    runCommand("docker", ["kill", opts.name], 10_000).catch(() => {});
  });
}

// ── source extraction ────────────────────────────────────────────────────────

interface SourceTree {
  /** rel path → bytes, sorted-key insertion order */
  files: Map<string, Uint8Array>;
  hash: string;
}

async function collectSource(
  zip: JSZip,
  prefix: string
): Promise<SourceTree> {
  const rels: string[] = [];
  for (const [p, f] of Object.entries(zip.files)) {
    if (f.dir) continue;
    if (!p.startsWith(prefix)) continue;
    const rel = p.substring(prefix.length);
    if (!rel) continue;
    if (rel.startsWith(".git/") || rel.startsWith("node_modules/")) continue;
    rels.push(rel);
  }
  rels.sort();

  if (rels.length > MAX_SOURCE_FILES) {
    throw new Error(
      `Plugin source has too many files to build server-side (${rels.length} > ${MAX_SOURCE_FILES})`
    );
  }

  const files = new Map<string, Uint8Array>();
  const hasher = crypto.createHash("sha256");
  hasher.update(`image:${IMAGE}\n`);
  let total = 0;
  for (const rel of rels) {
    const data = await zip.file(prefix + rel)!.async("uint8array");
    total += data.length;
    if (total > MAX_SOURCE_BYTES) {
      throw new Error(
        `Plugin source is too large to build server-side (>${MAX_SOURCE_BYTES / 1024 / 1024} MB)`
      );
    }
    files.set(rel, data);
    hasher.update(rel);
    hasher.update("\0");
    hasher.update(data);
  }
  return { files, hash: hasher.digest("hex") };
}

async function extractToDir(source: SourceTree, root: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const dirs = new Set<string>();
  for (const [rel, data] of source.files) {
    const dest = path.resolve(resolvedRoot, rel);
    if (
      dest !== resolvedRoot &&
      !dest.startsWith(resolvedRoot + path.sep)
    ) {
      continue; // zip-slip: entry escapes the extraction root
    }
    const dir = path.dirname(dest);
    if (!dirs.has(dir)) {
      await fs.mkdir(dir, { recursive: true });
      // Walk up chmod'ing so the container's unprivileged user can write
      // node_modules / dist anywhere in the tree.
      let d = dir;
      while (d.startsWith(resolvedRoot) && !dirs.has(d)) {
        dirs.add(d);
        await fs.chmod(d, 0o777).catch(() => {});
        d = path.dirname(d);
      }
    }
    await fs.writeFile(dest, data);
    await fs.chmod(dest, 0o666).catch(() => {});
  }
  await fs.chmod(resolvedRoot, 0o777).catch(() => {});
}

// ── output collection ────────────────────────────────────────────────────────

async function collectOutput(
  root: string,
  outDir: string
): Promise<Map<string, Uint8Array>> {
  const base = path.resolve(root, outDir);
  const files = new Map<string, Uint8Array>();
  let total = 0;

  async function walk(dir: string, relPrefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Symlinks are skipped: a malicious build could plant a link to a host
      // file and have it read back into the published bundle.
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (outDir === "" && SOURCE_DIRS.includes(rel + "/")) continue;
        if (
          rel === "node_modules" ||
          rel === ".npm-cache" ||
          rel === ".git" ||
          (outDir === "" && (rel === "dist" || rel === "build"))
        ) {
          continue;
        }
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        if (rel === "manifest.json") continue;
        if (shouldSkip(rel)) continue;
        if (files.size >= MAX_BUNDLE_FILES) {
          throw new Error(
            `Build output has too many files (>${MAX_BUNDLE_FILES})`
          );
        }
        const data = await fs.readFile(path.join(dir, entry.name));
        total += data.length;
        if (total > MAX_OUTPUT_BYTES) {
          throw new Error(
            `Build output exceeds ${MAX_OUTPUT_BYTES / 1024 / 1024} MB`
          );
        }
        files.set(rel, new Uint8Array(data));
      }
    }
  }

  await walk(base, "");
  return files;
}

// ── result cache ─────────────────────────────────────────────────────────────

async function readCache(hash: string): Promise<Map<string, Uint8Array> | null> {
  try {
    const buf = await fs.readFile(path.join(CACHE_DIR, `${hash}.zip`));
    const zip = await JSZip.loadAsync(buf);
    const files = new Map<string, Uint8Array>();
    for (const [p, f] of Object.entries(zip.files)) {
      if (f.dir) continue;
      files.set(p, await f.async("uint8array"));
    }
    return files.size > 0 ? files : null;
  } catch {
    return null;
  }
}

async function writeCache(
  hash: string,
  files: Map<string, Uint8Array>
): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const zip = new JSZip();
    for (const [rel, data] of files) zip.file(rel, data);
    const buf = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    await fs.writeFile(path.join(CACHE_DIR, `${hash}.zip`), buf);

    // Prune oldest entries beyond the cap.
    const names = (await fs.readdir(CACHE_DIR)).filter((n) =>
      n.endsWith(".zip")
    );
    if (names.length > MAX_CACHE_ENTRIES) {
      const stats = await Promise.all(
        names.map(async (n) => ({
          n,
          mtime: (await fs.stat(path.join(CACHE_DIR, n))).mtimeMs,
        }))
      );
      stats.sort((a, b) => a.mtime - b.mtime);
      for (const s of stats.slice(0, stats.length - MAX_CACHE_ENTRIES)) {
        await fs.unlink(path.join(CACHE_DIR, s.n)).catch(() => {});
      }
    }
  } catch {
    // Cache is best-effort; a failed write must not fail the build.
  }
}

// ── main entry ───────────────────────────────────────────────────────────────

/**
 * Try to build the plugin server-side. Returns null when the plugin is not
 * buildable this way (no package.json "build" script) so the caller can fall
 * through to its usual guidance. Throws a submitter-actionable Error when a
 * build was attempted (or should have been possible) but failed.
 */
export async function buildBundleInSandbox(
  zip: JSZip,
  prefix: string,
  manifest: NormalizedManifest
): Promise<ResolvedBundle | null> {
  // Only plugins with a declared build script qualify.
  const pkgFile = zip.file(`${prefix}package.json`);
  if (!pkgFile) return null;
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(await pkgFile.async("text"));
  } catch {
    return null;
  }
  const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>;
  if (typeof scripts.build !== "string" || !scripts.build.trim()) return null;

  if (!ENABLED) {
    throw new Error(
      `This plugin has a build step ("npm run build"), but server-side builds are disabled. ` +
        `Commit the built artifacts (dist/ directory or a prebuilt ${manifest.slug}.zip) instead.`
    );
  }
  if (!(await dockerAvailable())) {
    throw new Error(
      `This plugin has a build step ("npm run build"), but the server-side build sandbox is unavailable right now. ` +
        `Commit the built artifacts (dist/ directory or a prebuilt ${manifest.slug}.zip), or try again later.`
    );
  }

  const source = await collectSource(zip, prefix);

  // Content-addressed cache: submit-time scan and approval-time publish see
  // the same source bytes, so the second call is a cache hit.
  const cached = await readCache(source.hash);
  if (cached) {
    return {
      files: cached,
      source: "sandbox-build",
      note: "Built server-side with npm run build (cached)",
    };
  }

  const expected = manifest.type === "theme" ? "theme.css" : manifest.entrypoint;

  return withBuildLock(async () => {
    // Re-check the cache inside the lock — an identical build may have just
    // finished while we were queued.
    const raced = await readCache(source.hash);
    if (raced) {
      return {
        files: raced,
        source: "sandbox-build" as const,
        note: "Built server-side with npm run build (cached)",
      };
    }

    await fs.mkdir(TMP_ROOT, { recursive: true });
    const workDir = await fs.mkdtemp(path.join(TMP_ROOT, "build-"));
    const runId = crypto.randomBytes(6).toString("hex");
    try {
      await extractToDir(source, workDir);

      // Phase 1: install dependencies (network on).
      const hasLock = source.files.has("package-lock.json");
      let installCmd = hasLock
        ? "npm ci --no-audit --no-fund"
        : "npm install --no-audit --no-fund";
      let install = await runInContainer({
        name: `extbuild-${runId}-install`,
        dir: workDir,
        network: "bridge",
        command: installCmd,
        timeoutMs: PHASE_TIMEOUT_MS,
      });
      // A stale package-lock.json makes `npm ci` refuse to run (EUSAGE,
      // "…are in sync"). Don't fail the submission over it — fall back to a
      // plain `npm install`, which resolves from package.json.
      if (
        !install.timedOut &&
        install.code !== 0 &&
        installCmd.startsWith("npm ci") &&
        /EUSAGE|in sync|Missing:.*from lock file/.test(install.output)
      ) {
        installCmd = "npm install --no-audit --no-fund";
        install = await runInContainer({
          name: `extbuild-${runId}-install2`,
          dir: workDir,
          network: "bridge",
          command: installCmd,
          timeoutMs: PHASE_TIMEOUT_MS,
        });
      }
      if (install.timedOut) {
        throw new Error(
          `Server-side build failed: "${installCmd}" timed out after ${PHASE_TIMEOUT_MS / 1000}s.`
        );
      }
      if (install.code !== 0) {
        throw new Error(
          `Server-side build failed during "${installCmd}" (exit ${install.code}). ` +
            `If your package-lock.json is out of date, run "npm install" locally and commit the updated lock file. Log tail:\n${logTail(install.output)}`
        );
      }

      // Phase 2: run the build with no network access.
      const build = await runInContainer({
        name: `extbuild-${runId}-build`,
        dir: workDir,
        network: "none",
        command: "npm run build",
        timeoutMs: PHASE_TIMEOUT_MS,
      });
      if (build.timedOut) {
        throw new Error(
          `Server-side build failed: "npm run build" timed out after ${PHASE_TIMEOUT_MS / 1000}s.`
        );
      }
      if (build.code !== 0) {
        throw new Error(
          `Server-side build failed during "npm run build" (exit ${build.code}). ` +
            `Note: the build runs with no network access — fetch everything you need via dependencies. Log tail:\n${logTail(build.output)}`
        );
      }

      // Find the entrypoint among the usual output locations.
      let outDir: string | null = null;
      for (const dir of ["dist", "build", ""]) {
        const candidate = path.join(workDir, dir, expected);
        try {
          const st = await fs.lstat(candidate);
          if (st.isFile()) {
            outDir = dir;
            break;
          }
        } catch {
          // keep looking
        }
      }
      if (outDir === null) {
        throw new Error(
          `Server-side build succeeded, but ${expected} was not found in dist/, build/, or the plugin root afterwards. ` +
            `Make sure "npm run build" writes the entrypoint declared in manifest.json.`
        );
      }

      const outputs = await collectOutput(workDir, outDir);
      const files = new Map<string, Uint8Array>();
      const manifestBytes = source.files.get("manifest.json");
      if (!manifestBytes) {
        throw new Error("manifest.json disappeared from the source tree");
      }
      files.set("manifest.json", manifestBytes);
      for (const [rel, data] of outputs) files.set(rel, data);

      await writeCache(source.hash, files);

      const where = outDir ? `${outDir}/` : "the plugin root";
      return {
        files,
        source: "sandbox-build" as const,
        note: `Built server-side with npm run build (output from ${where})`,
      };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
