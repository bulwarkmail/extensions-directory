/**
 * Exercise the sandboxed server-side build against a real GitHub repo,
 * end-to-end but without touching the database: download the zipball,
 * validate the manifest, and run resolveBundle (which falls back to the
 * Docker sandbox build when no committed artifacts are found).
 *
 * Usage:
 *   npx tsx scripts/test-sandbox-build.ts <owner/repo> [ref] [subpath]
 *   npx tsx scripts/test-sandbox-build.ts <local-plugin-dir>
 *
 * Local-dir mode zips the directory's source (excluding node_modules/, dist/,
 * build/, and any prebuilt <slug>.zip) so the sandbox-build fallback is
 * exercised even for plugins that normally ship artifacts.
 *
 * Example:
 *   npx tsx scripts/test-sandbox-build.ts bulwarkmail/openpgp main
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import JSZip from "jszip";
import { downloadRefArchive, resolveRefSha } from "../lib/github";
import {
  fetchManifest,
  resolveBundle,
  validateManifest,
} from "../lib/manifest";

async function runLocal(dir: string) {
  const root = path.resolve(dir);
  const zip = new JSZip();
  const prefix = "local-test/";

  async function addDir(abs: string, rel: string) {
    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (["node_modules", "dist", "build", ".git"].includes(entry.name))
          continue;
        await addDir(path.join(abs, entry.name), childRel);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".zip")) continue;
        zip.file(prefix + childRel, await fs.readFile(path.join(abs, entry.name)));
      }
    }
  }
  await addDir(root, "");

  const manifestFile = zip.file(`${prefix}manifest.json`);
  if (!manifestFile) {
    console.error(`No manifest.json in ${root}`);
    process.exit(1);
  }
  const validation = validateManifest(JSON.parse(await manifestFile.async("text")));
  if (!validation.ok) {
    console.error(`Manifest invalid: ${validation.error}`);
    process.exit(1);
  }
  const manifest = validation.manifest;
  console.log(
    `manifest ok: ${manifest.slug}@${manifest.version} (entrypoint ${manifest.entrypoint})`
  );

  const started = Date.now();
  const resolved = await resolveBundle(zip, prefix, manifest);
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\nresolved in ${secs}s — source: ${resolved.source}`);
  console.log(`note: ${resolved.note}`);
  console.log(`files (${resolved.files.size}):`);
  for (const [rel, data] of resolved.files) {
    console.log(`  ${rel}  (${data.length} bytes)`);
  }
}

async function main() {
  const [repo, refArg, subpathArg] = process.argv.slice(2);
  if (!repo) {
    console.error(
      "Usage: npx tsx scripts/test-sandbox-build.ts <owner/repo | local-dir> [ref] [subpath]"
    );
    process.exit(1);
  }
  const isDir = await fs
    .stat(repo)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (isDir) {
    await runLocal(repo);
    return;
  }
  if (!repo.includes("/")) {
    console.error(
      "Usage: npx tsx scripts/test-sandbox-build.ts <owner/repo | local-dir> [ref] [subpath]"
    );
    process.exit(1);
  }
  const ref = refArg || "main";
  const subpath = (subpathArg || "").replace(/^\/+|\/+$/g, "");

  const sha = await resolveRefSha(repo, ref);
  if (!sha) {
    console.error(`Ref "${ref}" does not exist in ${repo}`);
    process.exit(1);
  }
  console.log(`ref ${ref} → ${sha}`);

  const manifestRaw = await fetchManifest(repo, sha, subpath);
  if (!manifestRaw) {
    console.error(`No manifest.json at ${subpath || "repo root"}`);
    process.exit(1);
  }
  const validation = validateManifest(manifestRaw);
  if (!validation.ok) {
    console.error(`Manifest invalid: ${validation.error}`);
    process.exit(1);
  }
  const manifest = validation.manifest;
  console.log(
    `manifest ok: ${manifest.slug}@${manifest.version} (entrypoint ${manifest.entrypoint})`
  );

  const zipBuf = await downloadRefArchive(repo, sha);
  const zip = await JSZip.loadAsync(zipBuf);
  const topDir = Object.keys(zip.files)[0].split("/")[0] + "/";
  const prefix = subpath ? `${topDir}${subpath}/` : topDir;

  const started = Date.now();
  const resolved = await resolveBundle(zip, prefix, manifest);
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\nresolved in ${secs}s — source: ${resolved.source}`);
  console.log(`note: ${resolved.note}`);
  console.log(`files (${resolved.files.size}):`);
  for (const [rel, data] of resolved.files) {
    console.log(`  ${rel}  (${data.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
