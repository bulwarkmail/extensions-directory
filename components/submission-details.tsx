import Link from "next/link";
import type { submissions } from "@/lib/db/schema";
import { renderMarkdown } from "@/lib/markdown";
import { source } from "@/lib/sources";
import { formatBytes, timeAgo } from "@/lib/utils";
import { Status } from "@/components/status";
import { ScanFindings, type ScanFinding } from "@/components/scan-findings";

type Submission = typeof submissions.$inferSelect;

interface Diff {
  previousVersion: string | null;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
  permissionsAdded: string[];
  permissionsRemoved: string[];
  originsAdded: Record<string, string[]>;
  tierChanged: { from: string | null; to: string | null } | null;
}

/** What the author and the reviewer both see about a submission. */
export function SubmissionDetails({ s }: { s: Submission }) {
  const scan = (s.scanReport ?? null) as { findings?: ScanFinding[] } | null;
  const compat = (s.compatReport ?? null) as { ok?: boolean; errors?: string[]; warnings?: string[]; webmail?: string } | null;
  const diff = (s.diffSummary ?? null) as Diff | null;
  const claims = (s.ciClaims ?? null) as Record<string, string> | null;
  let commitUrl: string | null = null;
  try {
    commitUrl = s.sourceCommit ? source(s.sourceHost).commitUrl(s.githubRepo, s.sourceCommit) : null;
  } catch {
    commitUrl = null;
  }
  const findings = scan?.findings ?? [];
  const media = s.media ?? null;
  return (
    <div className="dx-stack">
      <dl className="bw-deflist">
        <dt>Status</dt><dd><Status value={s.status} />{s.dryRun ? " (dry run)" : ""}</dd>
        <dt>Version</dt><dd>{s.slug} {s.version ?? "?"}</dd>
        <dt>Source</dt>
        <dd>
          {s.sourceHost}/{s.githubRepo}{s.subpath ? `/${s.subpath}` : ""} at <code className="bw-icode">{s.githubTag}</code>
          {s.sourceCommit ? <>, commit {commitUrl ? <a className="bw-link" href={commitUrl} target="_blank" rel="noopener noreferrer"><code className="bw-icode">{s.sourceCommit.slice(0, 12)}</code></a> : <code className="bw-icode">{s.sourceCommit.slice(0, 12)}</code>}</> : null}
        </dd>
        <dt>Submitted</dt>
        <dd>
          {timeAgo(s.submittedAt)} {s.submittedVia === "oidc" ? "by GitHub Actions" : s.submittedVia === "token" ? "with an API token" : s.submittedVia === "legacy" ? "on the old site" : "on the website"}
          {claims?.run_id && claims.repository ? <> (<a className="bw-link" href={`https://github.com/${claims.repository}/actions/runs/${claims.run_id}`} target="_blank" rel="noopener noreferrer">workflow run {claims.run_id}</a>, {claims.workflow_ref?.split("@")[0].split("/").slice(2).join("/")}{claims.environment ? `, environment ${claims.environment}` : ""})</> : null}
        </dd>
        {s.artifactSha256 ? <><dt>Bundle</dt><dd>{formatBytes(s.artifactSize ?? 0)}, SHA-256 <code className="bw-icode">{s.artifactSha256.slice(0, 16)}…</code>, {s.buildSource === "sandbox-build" ? `built by the directory${s.builderImage ? ` (${s.builderImage})` : ""}` : "plain files, no build step"}</dd></> : null}
        {s.reviewNotes && (s.status === "approved" || s.status === "rejected") ? <><dt>Reviewer notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{s.reviewNotes}</dd></> : null}
      </dl>

      {s.error ? <div className="bw-note bw-note-warning" style={{ whiteSpace: "pre-wrap" }}>{s.error}</div> : null}

      {compat ? (
        <section>
          <h3 className="bw-h3">Webmail install check</h3>
          {compat.ok ? <p><Status value="approved" /> A webmail ({compat.webmail}) would install this bundle.</p> : <ul>{compat.errors?.map((e) => <li key={e}>{e}</li>)}</ul>}
          {compat.warnings?.length ? <ul className="bw-help">{compat.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
        </section>
      ) : null}

      {scan ? (
        <section>
          <h3 className="bw-h3">Code scan</h3>
          {findings.length ? <ScanFindings findings={findings} /> : <p>No findings.</p>}
        </section>
      ) : null}

      {diff ? (
        <section>
          <h3 className="bw-h3">Changes {diff.previousVersion ? `since ${diff.previousVersion}` : "(first version)"}</h3>
          {diff.permissionsAdded.length ? <p className="bw-note bw-note-warning">New permissions: {diff.permissionsAdded.join(", ")}</p> : null}
          {Object.entries(diff.originsAdded).map(([k, v]) => <p key={k} className="bw-note bw-note-warning">New {k}: {v.join(", ")}</p>)}
          {diff.tierChanged ? <p className="bw-note bw-note-warning">Tier changes from {diff.tierChanged.from ?? "untrusted"} to {diff.tierChanged.to ?? "untrusted"}</p> : null}
          {diff.permissionsRemoved.length ? <p>Permissions no longer requested: {diff.permissionsRemoved.join(", ")}</p> : null}
          <p>{diff.added.length} added, {diff.changed.length} changed, {diff.removed.length} removed, {diff.unchanged} unchanged files.</p>
        </section>
      ) : null}

      {media && (media.icon || media.banner || media.screenshots?.length || media.warnings?.length) ? (
        <section>
          <h3 className="bw-h3">Images</h3>
          <p>{[media.icon ? "icon" : null, media.banner ? "banner" : null, media.screenshots?.length ? `${media.screenshots.length} screenshots` : null].filter(Boolean).join(", ") || "none"}, re-encoded.</p>
          {media.warnings?.length ? <ul className="bw-help">{media.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
        </section>
      ) : null}

      {s.releaseNotes ? (
        <section>
          <h3 className="bw-h3">Changelog</h3>
          <div className="ext-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.releaseNotes) }} />
        </section>
      ) : null}

      {s.buildLog ? (
        <details className="dx-details">
          <summary>Build log</summary>
          <pre className="bw-code dx-log"><code>{s.buildLog}</code></pre>
        </details>
      ) : null}
      <p className="bw-help"><Link className="bw-link" href="/publishing">How publishing works</Link></p>
    </div>
  );
}
