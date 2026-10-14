import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { downloadsLast30, manageData } from "@/lib/dashboard";
import { source } from "@/lib/sources";
import { formatDate, timeAgo } from "@/lib/utils";
import { Status } from "@/components/status";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { DashboardNav } from "@/components/dashboard-nav";
import { ActionButton, ActionForm } from "@/components/client/action";
import { SubmitVersionForm } from "./submit-form";

export const metadata: Metadata = { title: "Manage extension" };
export const dynamic = "force-dynamic";

const via = (v: string | null) => (v === "oidc" ? "GitHub Actions" : v === "token" ? "API token" : v === "legacy" ? "old site" : "website");

export default async function ManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  if (!user) return <SignInPrompt title="Sign in to manage this extension." text="Only its maintainers can manage an extension." returnTo={`/dashboard/extensions/${slug}`} />;
  const data = await manageData(slug, user);
  if (!data) notFound();
  const { ext, role, staff, versions, members, publishers, submissions, textChanges } = data;
  const base = `/extensions/${ext.slug}`;
  const owner = role === "owner" || staff;
  const src = source(ext.sourceHost);
  const last30 = downloadsLast30(ext.id);
  const pending = textChanges.filter((t) => t.status === "pending");
  const workflow = `name: Publish to Bulwark Extensions
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
  id-token: write   # lets the job ask GitHub for an OIDC token
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: release   # optional; must match the publisher below
    steps:
      - uses: bulwarkmail/publish-extension@v1${ext.subpath ? `\n        with:\n          subpath: ${ext.subpath}` : ""}`;

  return (
    <div className="bw-w dx-work">
      <DashboardNav current="/dashboard" />
      <div className="dx-work-head">
        <div>
          <p className="bw-crumb"><Link href="/dashboard" className="bw-link">Your extensions</Link></p>
          <h1 className="bw-h2">{ext.name}</h1>
          <div className="dx-rows-meta">
            <Status value={ext.status} />
            {ext.deprecatedAt ? <Status value="deprecated" /> : null}
            <code className="bw-icode">{ext.slug}</code>
            <a className="bw-link" href={src.repoUrl(ext.githubRepo)} target="_blank" rel="noopener noreferrer">{ext.sourceHost}/{ext.githubRepo}{ext.subpath ? `/${ext.subpath}` : ""}</a>
            {ext.status === "approved" ? <Link className="bw-link" href={`/extension/${ext.slug}`}>Public page</Link> : null}
          </div>
          {ext.status === "suspended" ? <p className="bw-note bw-note-warning">This extension is suspended{ext.suspendedReason ? `: ${ext.suspendedReason}` : ""}. Nothing of it can be downloaded or published.</p> : null}
          {ext.status === "pending" && ext.reservedAt ? <p className="bw-help">Reserved {formatDate(ext.reservedAt)}. Publish a version within 90 days of that, or the name is released.</p> : null}
        </div>
      </div>

      <section className="dx-sec-block">
        <h2 className="dx-h2">Submit a version</h2>
        <p>The directory fetches the repository at this ref, builds it, runs the webmail&apos;s install checks and the scanner, then queues it for review. A dry run does all of that without the review.</p>
        <SubmitVersionForm slug={ext.slug} />
      </section>

      <section className="dx-sec-block">
        <h2 className="dx-h2">Publish from CI</h2>
        <p>
          With trusted publishing, a GitHub Actions workflow submits versions with a short-lived token GitHub issues to it. No secret is stored anywhere.
          Add the workflow below to the repository, then register it here.
        </p>
        <pre className="bw-code"><code>{workflow}</code></pre>
        {publishers.length ? (
          <div className="bw-table-wrap">
            <table className="bw-table">
              <thead><tr><th scope="col">Repository</th><th scope="col">Workflow</th><th scope="col">Environment</th><th scope="col">Folder</th><th scope="col">Refs</th><th scope="col">Last used</th><th scope="col"><span className="bw-muted">Actions</span></th></tr></thead>
              <tbody>
                {publishers.map((p) => (
                  <tr key={p.id}>
                    <td>{p.repository}</td>
                    <td><code className="bw-icode">{p.workflowPath}</code></td>
                    <td>{p.environment ?? "any"}</td>
                    <td>{p.subpath || "root"}</td>
                    <td>{p.allowedRefs === "tags" ? "tags only" : "any (dry runs from PRs too)"}</td>
                    <td>{p.lastUsedAt ? timeAgo(p.lastUsedAt) : "never"}{p.disabledAt ? " (disabled)" : ""}</td>
                    <td><ActionButton method="DELETE" path={`${base}/publishers/${p.id}`} label="Remove" ghost small confirm="Remove this trusted publisher?" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <details className="dx-details">
          <summary>Add a trusted publisher</summary>
          <ActionForm path={`${base}/publishers`} submit="Add publisher" fields={[
            { name: "repository", label: "GitHub repository", defaultValue: ext.sourceHost === "github.com" ? ext.githubRepo : "", placeholder: "owner/repo" },
            { name: "workflowPath", label: "Workflow file", defaultValue: ".github/workflows/publish.yml" },
            { name: "environment", label: "GitHub environment", optional: true, placeholder: "release", help: "When set, only jobs in this environment can publish. Use an environment with required reviewers for an extra check." },
            { name: "subpath", label: "Folder in the repository", optional: true, defaultValue: ext.subpath },
            { name: "allowedRefs", label: "Publish from", type: "select", options: [{ value: "tags", label: "Tags only" }, { value: "any", label: "Any ref" }] },
          ]} />
        </details>
        <p className="bw-help">Not on GitHub, or publishing from a script? Create an <Link href="/dashboard/tokens" className="bw-link">API token</Link> scoped to this extension and use the CLI.</p>
      </section>

      <section className="dx-sec-block">
        <h2 className="dx-h2">Submissions</h2>
        {submissions.length === 0 ? <p className="bw-help">No submissions yet.</p> : (
          <div className="bw-table-wrap">
            <table className="bw-table">
              <thead><tr><th scope="col">Status</th><th scope="col">Version</th><th scope="col">Commit</th><th scope="col">Via</th><th scope="col">Submitted</th></tr></thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td><Status value={s.status} /></td>
                    <td><Link className="bw-link" href={`/dashboard/submissions/${s.id}`}>{s.version ?? "?"}{s.dryRun ? " (dry run)" : ""}</Link></td>
                    <td>{s.sourceCommit ? <code className="bw-icode">{s.sourceCommit.slice(0, 7)}</code> : null} <span className="bw-muted">{s.githubTag}</span></td>
                    <td>{via(s.submittedVia)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{timeAgo(s.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dx-sec-block">
        <h2 className="dx-h2">Versions</h2>
        {versions.length === 0 ? <p className="bw-help">Nothing published yet.</p> : (
          <div className="bw-table-wrap">
            <table className="bw-table">
              <thead><tr><th scope="col">Version</th><th scope="col">Published</th><th scope="col">Works with</th><th scope="col">Downloads</th><th scope="col">Built from</th><th scope="col"><span className="bw-muted">Actions</span></th></tr></thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>{v.version} {v.channel === "beta" ? <Status value="beta" /> : null} {v.yankedAt ? <Status value="yanked" /> : null}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{v.publishedAt ? formatDate(v.publishedAt) : ""}</td>
                    <td>{v.minAppVersion ? `${v.minAppVersion}+` : "any"}{v.maxAppVersion ? ` up to ${v.maxAppVersion}` : ""}</td>
                    <td className="num">{v.downloadCount}{last30.get(v.version) ? <span className="bw-muted"> ({last30.get(v.version)} in 30 days)</span> : null}</td>
                    <td>{v.sourceCommit && v.sourceRepo ? <a className="bw-link" href={source(v.sourceHost ?? "github.com").commitUrl(v.sourceRepo, v.sourceCommit)} target="_blank" rel="noopener noreferrer"><code className="bw-icode">{v.sourceCommit.slice(0, 7)}</code></a> : <span className="bw-muted">{v.sourceRef ?? "unknown"}</span>} via {via(v.submittedVia)}</td>
                    <td>
                      <div className="dx-rowact">
                        {v.yankedAt
                          ? <ActionButton path={`${base}/versions/${encodeURIComponent(v.version)}/unyank`} label="Restore" ghost small />
                          : <ActionButton path={`${base}/versions/${encodeURIComponent(v.version)}/yank`} label="Yank" ghost small ask="Why is this version yanked? Webmails running it are shown this." />}
                        <ActionButton method="PATCH" path={`${base}/versions/${encodeURIComponent(v.version)}`} label="Set max app version" ghost small ask="Highest Bulwark version this release works with (e.g. 2.0.0), or leave empty for none." askField="maxAppVersion" askRequired={false} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {versions.length ? (
          <details className="dx-details">
            <summary>Edit a changelog</summary>
            <p className="bw-help">Changelogs come from the release notes of the tag. An edit waits for a reviewer before it shows.</p>
            {versions.slice(0, 5).map((v) => (
              <details key={v.id} className="dx-details">
                <summary>{v.version}</summary>
                <ActionForm method="PATCH" path={`${base}/versions/${encodeURIComponent(v.version)}`} submit="Send for review" resetOnDone={false}
                  fields={[{ name: "changelog", label: "Changelog (Markdown)", type: "textarea", defaultValue: v.changelog ?? "", optional: true }]} />
              </details>
            ))}
          </details>
        ) : null}
      </section>

      <section className="dx-sec-block">
        <h2 className="dx-h2">Listing</h2>
        <p>Changes to the public text wait for a reviewer; the page keeps the approved text until then.</p>
        {pending.length ? (
          <ul className="dx-stack">
            {pending.map((t) => <li key={t.id}><Status value="awaiting_review" /> {t.field.replace("_", " ")}, sent {timeAgo(t.proposedAt)}</li>)}
          </ul>
        ) : null}
        {textChanges.filter((t) => t.status === "rejected").slice(0, 3).map((t) => (
          <p key={t.id} className="bw-help bw-help-error">Your change to the {t.field.replace("_", " ")} was not approved: {t.reviewNotes}</p>
        ))}
        <ActionForm method="PATCH" path={base} submit="Send for review" resetOnDone={false} fields={[
          { name: "description", label: "One-line description", defaultValue: ext.description },
          { name: "longDescription", label: "Long description (Markdown)", type: "textarea", optional: true, defaultValue: ext.longDescription ?? "", rows: 10 },
        ]} />
      </section>

      <section className="dx-sec-block">
        <h2 className="dx-h2">Source</h2>
        <p>Where the next version is built from. Takes effect with the next submission.</p>
        <ActionForm method="PATCH" path={base} submit="Save source" resetOnDone={false} fields={[
          { name: "repository", label: "Repository", defaultValue: `https://${ext.sourceHost}/${ext.githubRepo}` },
          { name: "subpath", label: "Folder in the repository", optional: true, defaultValue: ext.subpath },
        ]} />
      </section>

      <section className="dx-sec-block">
        <h2 className="dx-h2">Maintainers</h2>
        <ul className="dx-rows">
          {members.map((m) => (
            <li key={m.authorId}>
              <div style={{ minWidth: 0 }}>
                <span className="dx-rows-name">@{m.login}</span>
                <div className="dx-rows-meta"><span>{m.role === "owner" ? "Owner" : "Maintainer"}</span></div>
              </div>
              <div className="dx-rows-actions">
                {owner || m.authorId === user.id ? <ActionButton method="DELETE" path={`${base}/members/${m.authorId}`} label={m.authorId === user.id ? "Leave" : "Remove"} ghost small confirm="Remove this maintainer?" /> : null}
              </div>
            </li>
          ))}
        </ul>
        {owner ? (
          <details className="dx-details">
            <summary>Add a maintainer</summary>
            <ActionForm path={`${base}/members`} submit="Add" fields={[
              { name: "login", label: "GitHub login", help: "They need to have signed in to the directory once." },
              { name: "role", label: "Role", type: "select", options: [{ value: "maintainer", label: "Maintainer: submit versions, yank, edit" }, { value: "owner", label: "Owner: also manage maintainers, deprecate, archive" }] },
            ]} />
          </details>
        ) : null}
      </section>

      {owner && ext.status !== "pending" ? (
        <section className="dx-sec-block">
          <h2 className="dx-h2">Retire</h2>
          {ext.deprecatedAt ? (
            <p>Deprecated {formatDate(ext.deprecatedAt)}{ext.replacementSlug ? `, replaced by ${ext.replacementSlug}` : ""}. <ActionButton path={`${base}/undeprecate`} label="Undo deprecation" ghost small /></p>
          ) : (
            <details className="dx-details">
              <summary>Deprecate</summary>
              <p className="bw-help">Still installable, listed lower, and webmails that have it installed are told. The message is reviewed before it shows.</p>
              <ActionForm path={`${base}/deprecate`} submit="Deprecate" fields={[
                { name: "message", label: "Message", type: "textarea", optional: true, rows: 3 },
                { name: "replacement", label: "Replacement extension id", optional: true },
              ]} />
            </details>
          )}
          {ext.status === "archived"
            ? <ActionButton path={`${base}/archive`} body={{ archived: false }} label="List it again" ghost />
            : <ActionButton path={`${base}/archive`} body={{ archived: true }} label="Archive" ghost confirm="Archive this extension? It disappears from search; installed copies keep working." />}
        </section>
      ) : null}
    </div>
  );
}
