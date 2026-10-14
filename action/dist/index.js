"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// action/src/main.ts
var import_fs = __toESM(require("fs"));

// packages/cli/src/client.ts
var DEFAULT_DIRECTORY = "https://extensions.bulwarkmail.org";
var PublishError = class extends Error {
  constructor(message, status2, code) {
    super(message);
    this.status = status2;
    this.code = code;
  }
};
var SETTLED = /* @__PURE__ */ new Set(["awaiting_review", "publishing", "approved", "rejected", "withdrawn", "build_failed", "blocked", "dry_run_passed", "dry_run_failed"]);
var FAILED = /* @__PURE__ */ new Set(["build_failed", "blocked", "dry_run_failed", "rejected"]);
async function call(url, init) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", "User-Agent": "bulwarkmail-extension-cli", ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PublishError(body.error?.message ?? `${res.status} ${res.statusText}`, res.status, body.error?.code);
  return body.data;
}
async function githubOidcToken(audience) {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) return null;
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}audience=${encodeURIComponent(audience)}`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new PublishError(`Could not get an OIDC token from GitHub (${res.status}). Does the job have "permissions: id-token: write"?`);
  const { value } = await res.json();
  if (!value) throw new PublishError("GitHub returned no OIDC token");
  return value;
}
async function submit(opts) {
  const directory = (opts.directory || DEFAULT_DIRECTORY).replace(/\/+$/, "");
  let credential = opts.token || null;
  if (!credential) credential = await githubOidcToken(new URL(directory).origin);
  if (!credential) throw new PublishError("No credentials: set BULWARK_EXTENSIONS_TOKEN, or run in GitHub Actions with id-token: write and a trusted publisher set up.");
  const body = {};
  if (opts.slug) body.slug = opts.slug;
  if (opts.ref) body.ref = opts.ref;
  if (opts.subpath !== void 0 && opts.subpath !== "") body.subpath = opts.subpath;
  return call(`${directory}/api/v2/publish${opts.dryRun ? "/dry-run" : ""}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}` },
    body: JSON.stringify(body)
  });
}
async function status(statusUrl, credential) {
  return call(statusUrl, { headers: { Authorization: `Bearer ${credential}` } });
}
async function waitFor(sub, credential, opts = {}) {
  const deadline = Date.now() + (opts.timeoutMs ?? 20 * 6e4);
  let current = sub;
  let delay = 3e3;
  while (!SETTLED.has(current.status)) {
    if (Date.now() > deadline) throw new PublishError(`Still ${current.status} after waiting; follow it at ${current.url}`);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 3e4);
    current = await status(current.statusUrl, credential);
    opts.onUpdate?.(current);
  }
  return current;
}
function describe(s) {
  const lines = [`${s.slug} ${s.version ?? ""}: ${s.status.replace(/_/g, " ")}${s.dryRun ? " (dry run)" : ""}`, `  ${s.url}`];
  if (s.source?.commit) lines.push(`  built from ${s.source.repo}@${s.source.commit.slice(0, 12)}${s.source.subpath ? ` (${s.source.subpath})` : ""}`);
  if (s.error) lines.push(...s.error.split("\n").map((l) => `  ! ${l}`));
  for (const e of s.checks?.webmail?.errors ?? []) lines.push(`  ! webmail would refuse it: ${e}`);
  for (const f of s.checks?.scan?.findings ?? []) lines.push(`  ${f.severity === "block" ? "!" : "-"} ${f.rule}: ${f.message}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""}`);
  return lines.join("\n");
}

// action/src/main.ts
function input(name) {
  return (process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) import_fs.default.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value.replace(/\r?\n/g, " ")}
`);
}
function summary(s) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const rows = [
    `### ${s.dryRun ? "Dry run" : "Submission"} of ${s.slug} ${s.version ?? ""}: ${s.status.replace(/_/g, " ")}`,
    "",
    `[Open on the directory](${s.url})`,
    ""
  ];
  if (s.status === "awaiting_review") rows.push("Built and checked. A reviewer approves it before it is published; you get an email with the result.", "");
  if (s.error) rows.push("```", s.error, "```", "");
  const findings = s.checks?.scan?.findings ?? [];
  const compat = s.checks?.webmail;
  if (compat && !compat.ok) rows.push("**The webmail would refuse this bundle:**", ...compat.errors.map((e) => `- ${e}`), "");
  if (findings.length) rows.push("| | Rule | Where | Message |", "|---|---|---|---|", ...findings.map((f) => `| ${f.severity === "block" ? "\u274C" : "\u26A0\uFE0F"} | \`${f.rule}\` | ${f.file ?? ""}${f.line ? `:${f.line}` : ""} | ${f.message} |`), "");
  import_fs.default.appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows.join("\n") + "\n");
}
async function run() {
  const token = input("token") || null;
  const sub = await submit({
    directory: input("directory-url") || void 0,
    token,
    slug: input("slug") || void 0,
    ref: input("ref") || void 0,
    subpath: input("subpath"),
    dryRun: input("dry-run") === "true"
  });
  console.log(`Submitted ${sub.slug} ${sub.version}: ${sub.url}`);
  output("submission-id", sub.id);
  output("submission-url", sub.url);
  let final = sub;
  if (input("wait") !== "false") {
    final = await waitFor(sub, sub.pollToken ?? token ?? "", { onUpdate: (s) => console.log(`  ${s.status.replace(/_/g, " ")}`) });
  }
  output("status", final.status);
  console.log(describe(final));
  summary(final);
  if (FAILED.has(final.status)) {
    process.exitCode = 1;
    console.log(`::error title=Bulwark Extensions::${final.slug} ${final.version} ${final.status.replace(/_/g, " ")}: ${(final.error ?? "see the job summary").split("\n")[0]}`);
  }
}
run().catch((err) => {
  process.exitCode = 1;
  const message = err instanceof PublishError ? err.message : String(err);
  console.log(`::error title=Bulwark Extensions::${message.replace(/\r?\n/g, " ")}`);
});
