// The publish-extension GitHub Action. A JavaScript action (not a reusable
// workflow), so the OIDC token's workflow_ref names the author's own
// workflow file, which is what trusted publishers are matched on.
// No dependencies: inputs come from INPUT_* variables, outputs and the job
// summary go to the files GitHub names in GITHUB_OUTPUT and GITHUB_STEP_SUMMARY.
import fs from "fs";
import { FAILED, PublishError, describe, submit, waitFor, type Submission } from "../../packages/cli/src/client";

function input(name: string): string {
  return (process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}

function output(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value.replace(/\r?\n/g, " ")}\n`);
}

function summary(s: Submission) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const rows = [
    `### ${s.dryRun ? "Dry run" : "Submission"} of ${s.slug} ${s.version ?? ""}: ${s.status.replace(/_/g, " ")}`,
    "",
    `[Open on the directory](${s.url})`,
    "",
  ];
  if (s.status === "awaiting_review") rows.push("Built and checked. A reviewer approves it before it is published; you get an email with the result.", "");
  if (s.error) rows.push("```", s.error, "```", "");
  const findings = s.checks?.scan?.findings ?? [];
  const compat = s.checks?.webmail;
  if (compat && !compat.ok) rows.push("**The webmail would refuse this bundle:**", ...compat.errors.map((e) => `- ${e}`), "");
  if (findings.length) rows.push("| | Rule | Where | Message |", "|---|---|---|---|", ...findings.map((f) => `| ${f.severity === "block" ? "❌" : "⚠️"} | \`${f.rule}\` | ${f.file ?? ""}${f.line ? `:${f.line}` : ""} | ${f.message} |`), "");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows.join("\n") + "\n");
}

async function run(): Promise<void> {
  const token = input("token") || null;
  const sub = await submit({
    directory: input("directory-url") || undefined,
    token,
    slug: input("slug") || undefined,
    ref: input("ref") || undefined,
    subpath: input("subpath"),
    dryRun: input("dry-run") === "true",
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
