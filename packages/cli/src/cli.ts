#!/usr/bin/env node
// npx @bulwarkmail/extension-cli <command>
//
//   validate [dir]                      check a folder like the directory would, offline
//   publish  --slug <id> --ref <ref>    submit a version for review
//   dry-run  --slug <id> --ref <ref>    build and check only
//   status   <statusUrl or id>          show a submission
//
// Credentials: BULWARK_EXTENSIONS_TOKEN (an API token from the dashboard),
// or, inside GitHub Actions with "id-token: write", a trusted publisher.
import fs from "fs";
import path from "path";
import { validateManifest } from "../../../lib/manifest";
import { resolveBundleFiles, zipBundle, BuildError } from "../../../lib/pipeline/resolve";
import { pickOutput } from "../../../lib/pipeline/sandbox";
import { checkBundle } from "../../../lib/webmail-compat";
import { WEBMAIL_SOURCE } from "../../../lib/webmail-compat/vendor/source";
import { scanBundle } from "../../../lib/scanner";
import { DEFAULT_DIRECTORY, FAILED, PublishError, describe, status, submit, waitFor } from "./client";

function args(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

function readTree(root: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (dir: string, prefix: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (e.isFile()) out.set(rel, fs.readFileSync(path.join(dir, e.name)));
    }
  };
  walk(root, "");
  return out;
}

async function validate(dir: string): Promise<number> {
  const tree = readTree(path.resolve(dir));
  const manifestBytes = tree.get("manifest.json");
  if (!manifestBytes) {
    console.error(`No manifest.json in ${dir}`);
    return 1;
  }
  const v = validateManifest(JSON.parse(Buffer.from(manifestBytes).toString("utf8")));
  if (!v.ok) {
    console.error(`manifest.json: ${v.error}`);
    return 1;
  }
  const m = v.manifest;
  let files: Map<string, Uint8Array>;
  let note: string;
  const pkg = tree.get("package.json");
  const hasBuild = !!pkg && typeof JSON.parse(Buffer.from(pkg).toString("utf8"))?.scripts?.build === "string";
  try {
    if (hasBuild) {
      // The directory runs npm ci --ignore-scripts && npm run build itself;
      // here we check what your last local build produced.
      ({ files } = pickOutput(tree, m.type === "theme" ? "theme.css" : m.entrypoint, manifestBytes));
      note = "from your local build (the directory builds again from the commit you submit)";
    } else {
      ({ files } = await resolveBundleFiles(tree, m));
      note = "the plain files (no build step)";
    }
  } catch (err) {
    console.error(err instanceof BuildError ? err.message : String(err));
    return 1;
  }
  const zip = await zipBundle(files);
  const compat = await checkBundle(zip, m.type, m.slug);
  const scan = await scanBundle({ files }, m);
  console.log(`${m.slug} ${m.version}: ${files.size} files, ${zip.length} bytes, ${note}`);
  console.log(`Webmail install check (${WEBMAIL_SOURCE}): ${compat.ok ? "passes" : "fails"}`);
  for (const e of compat.errors) console.log(`  ! ${e}`);
  for (const w of compat.warnings) console.log(`  - ${w}`);
  console.log(`Code scan: ${scan.findings.length ? `${scan.findings.length} findings` : "no findings"}`);
  for (const f of scan.findings) console.log(`  ${f.severity === "block" ? "!" : "-"} ${f.rule}: ${f.message}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""}`);
  return compat.ok && !scan.blocked ? 0 : 1;
}

async function main(): Promise<number> {
  const [command, ...argv] = process.argv.slice(2);
  const { flags, rest } = args(argv);
  const directory = String(flags.directory || process.env.BULWARK_EXTENSIONS_URL || DEFAULT_DIRECTORY);
  const token = process.env.BULWARK_EXTENSIONS_TOKEN || null;

  switch (command) {
    case "validate":
      return validate(rest[0] ?? ".");
    case "publish":
    case "dry-run": {
      const sub = await submit({
        directory, token,
        slug: flags.slug ? String(flags.slug) : undefined,
        ref: flags.ref ? String(flags.ref) : undefined,
        subpath: flags.subpath !== undefined ? String(flags.subpath) : undefined,
        dryRun: command === "dry-run",
      });
      console.log(`Submitted ${sub.slug} ${sub.version}: ${sub.url}`);
      if (flags["no-wait"]) return 0;
      const done = await waitFor(sub, sub.pollToken ?? token ?? "", { onUpdate: (s) => console.log(`  ${s.status.replace(/_/g, " ")}`) });
      console.log(describe(done));
      return FAILED.has(done.status) ? 1 : 0;
    }
    case "status": {
      const target = rest[0];
      if (!target) throw new PublishError("Give the statusUrl or the submission id");
      const url = target.startsWith("http") ? target : `${directory.replace(/\/+$/, "")}/api/v2/submissions/${target}`;
      const credential = String(flags["poll-token"] || token || "");
      console.log(describe(await status(url, credential)));
      return 0;
    }
    default:
      console.log("Usage: extension-cli <validate [dir] | publish --slug <id> --ref <ref> [--subpath p] | dry-run ... | status <id>> [--directory URL] [--no-wait]");
      return command ? 2 : 0;
  }
}

main().then((code) => process.exit(code), (err) => {
  console.error(err instanceof PublishError ? err.message : err);
  process.exit(1);
});
