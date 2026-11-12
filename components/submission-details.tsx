import Link from "next/link";
import type { submissions } from "@/lib/db/schema";
import { renderMarkdown } from "@/lib/markdown";
import { source } from "@/lib/sources";
import { formatBytes, timeAgo } from "@/lib/utils";
import { Status } from "@/components/status";
import { ScanFindings, type ScanFinding } from "@/components/scan-findings";
import { GrantList } from "@/components/permission-badge";
import { grantOf } from "@/lib/webmail-compat";

type Submission = typeof submissions.$inferSelect;

const NOTES_SOURCE: Record<NonNullable<Submission["releaseNotesSource"]>, string> = {
  file: "From the version's section of CHANGELOG.md.",
  release: "From the release notes of the tag.",
  manifest: "From the changelog in manifest.json.",
};

interface Diff {
  previousVersion: string | null;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
  permissionsAdded: string[];
  permissionsRemoved: string[];
  // Missing in diffs stored before optional permissions were counted.
  optionalPermissionsAdded?: string[];
  keystoreAdded?: boolean;
  originsAdded: Record<string, string[]>;
  // Missing in diffs stored before credential bindings were counted.
  credentialsChanged?: { credential: string; before: string | null; after: string }[];
  formerSecrets?: string[];
  tierChanged: { from: string | null; to: string | null } | null;
}

const ORIGIN_LINES: Record<string, string> = {
  httpOrigins: "New servers it may contact (httpOrigins)",
  apiPostPaths: "New webmail routes it may call in the user's name (apiPostPaths)",
  frameOrigins: "New sites it may show inside the webmail (frameOrigins)",
  credentials: "New servers its stored credentials are sent to (credentials, through http:proxy)",
};

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
  const grant = s.manifestSnapshot ? grantOf(s.manifestSnapshot) : null;
  const isTheme = s.manifestSnapshot?.type === "theme";
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

      {grant ? (
        <section>
          <h3 className="bw-h3">What a webmail grants this version</h3>
          <p className="bw-help">Its permissions with the optional ones, its tier, and where it may send data, as the webmail reads them from manifest.json.</p>
          {!grant.checked ? <p className="bw-note bw-note-warning">The webmail check refuses this manifest; the list shows everything it asks for.</p> : null}
          {grant.unknownOptionalPermissions.length ? (
            <p className="bw-note bw-note-warning">Optional permissions this webmail doesn&apos;t know, left out now and granted by a newer webmail that offers them: {grant.unknownOptionalPermissions.join(", ")}</p>
          ) : null}
          <GrantList grant={grant} isTheme={isTheme} />
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
          {diff.tierChanged && diff.tierChanged.from === null && diff.tierChanged.to === "privileged" ? (
            <p className="bw-note bw-note-warning"><strong>Privileged tier.</strong> It runs in a frame on the webmail&apos;s own origin, with the webmail&apos;s own storage and cryptography, instead of the closed sandbox.</p>
          ) : diff.tierChanged ? <p className="bw-note bw-note-warning">Tier changes from {diff.tierChanged.from ?? "untrusted"} to {diff.tierChanged.to ?? "untrusted"}</p> : null}
          {diff.keystoreAdded ? (
            <p className="bw-note bw-note-warning">
              <strong>This version newly asks for keystore.</strong> It can ask to sign and decrypt with the certificates and smart cards on each user&apos;s computer. Check why it needs that, and that it only uses api.keystore.
            </p>
          ) : null}
          {diff.permissionsAdded.length ? <p className="bw-note bw-note-warning">New permissions: {diff.permissionsAdded.join(", ")}</p> : null}
          {diff.optionalPermissionsAdded?.length ? <p className="bw-note bw-note-warning">New optional permissions, granted like the others: {diff.optionalPermissionsAdded.join(", ")}</p> : null}
          {Object.entries(diff.originsAdded).map(([k, v]) => <p key={k} className="bw-note bw-note-warning">{ORIGIN_LINES[k] ?? `New ${k}`}: {v.join(", ")}</p>)}
          {diff.credentialsChanged?.map((c) => (
            <p key={`cred-${c.credential}`} className="bw-note bw-note-warning">
              {c.before ? `Credential "${c.credential}": now ${c.after}; before, ${c.before}.` : `New credential "${c.credential}": ${c.after}.`}
            </p>
          ))}
          {diff.formerSecrets?.length ? (
            <p className="bw-note bw-note-warning">
              {`Settings no longer secret: ${diff.formerSecrets.map((k) => `"${k}"`).join(", ")}. What is entered there from now on can be read by every signed-in user and by the plugin itself.`}
            </p>
          ) : null}
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
          {s.releaseNotesSource ? <p className="bw-help">{NOTES_SOURCE[s.releaseNotesSource]}</p> : null}
          <div className="ext-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.releaseNotes) }} />
        </section>
      ) : s.artifactSha256 ? (
        <section>
          <h3 className="bw-h3">Changelog</h3>
          <p className="bw-help">
            No notes for {s.version ?? "this version"}: there is no section for it in a CHANGELOG.md in the folder, no release for the tag
            and no changelog in manifest.json. Admins updating to it see no changelog.
          </p>
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
