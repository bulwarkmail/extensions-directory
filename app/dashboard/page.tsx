import Link from "next/link";
import { ArrowRight, Clock, Github } from "lucide-react";
import type { Metadata } from "next";
import { getAuthorSession } from "@/lib/auth";
import {
  getAuthorByGithubId,
  getExtensionsByAuthorId,
  getSubmissionsByAuthorId,
} from "@/lib/db/queries";
import { formatDate, timeAgo } from "@/lib/utils";
import { UpdateExtensionButton } from "@/components/update-extension-button";
import { EditExtensionButton } from "@/components/edit-extension-button";
import { ExtIcon, formatTypeLabel } from "@/components/ext-icon";
import { Status } from "@/components/status";
import { ICON } from "@/components/icon";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your published extensions and submissions.",
};

// Display only: githubRepo may be "owner/repo" or a full URL.
const repoName = (r: string) => r.replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");

export default async function DashboardPage() {
  const session = await getAuthorSession();

  if (!session.authorId || !session.githubId) {
    return <SignedOutView />;
  }

  const author = await getAuthorByGithubId(session.githubId);
  if (!author || author.banned) {
    return <SignedOutView />;
  }

  const [extensions, recentSubmissions] = await Promise.all([
    getExtensionsByAuthorId(author.id),
    getSubmissionsByAuthorId(author.id, 10),
  ]);

  return (
    <div className="bw-w dx-work">
      <div className="dx-work-head">
        <div>
          <h1 className="bw-h2">Your extensions</h1>
          <p>Submit updates, change settings and follow the review of every extension you publish.</p>
        </div>
        <Link href="/submit" className="bw-btn">
          Submit a new extension
          <ArrowRight size={16} {...ICON} />
        </Link>
      </div>

      {extensions.length === 0 ? (
        <div className="dx-empty" style={{ paddingTop: 0 }}>
          <h2 className="dx-h2" style={{ marginBottom: 0 }}>
            You have not published an extension yet.
          </h2>
          <p>Submit a plugin or theme from a public GitHub repository. It appears here while it is reviewed.</p>
        </div>
      ) : (
        <ul className="dx-rows">
          {extensions.map((ext) => {
            const lastSub = ext.lastSubmission;
            const openSub = ext.openSubmission;
            const currentSubpath = ext.subpath ?? lastSub?.subpath ?? "";
            const repo = `${repoName(ext.githubRepo)}${currentSubpath ? `/${currentSubpath}` : ""}`;

            return (
              <li key={ext.id}>
                <ExtIcon name={ext.name} iconPath={ext.iconPath} />
                <div style={{ minWidth: 0 }}>
                  {ext.status === "approved" ? (
                    <Link href={`/extension/${ext.slug}`} className="dx-rows-name">
                      {ext.name}
                    </Link>
                  ) : (
                    <span className="dx-rows-name">{ext.name}</span>
                  )}
                  <div className="dx-rows-meta">
                    <Status value={ext.status} />
                    <span>{formatTypeLabel(ext.type, ext.pluginType)}</span>
                    {ext.latestVersion ? (
                      <span>
                        Version {ext.latestVersion.version}
                        {ext.latestVersion.publishedAt ? `, published ${formatDate(ext.latestVersion.publishedAt)}` : ""}
                      </span>
                    ) : null}
                    <a
                      href={`https://github.com/${repoName(ext.githubRepo)}${currentSubpath ? `/tree/HEAD/${currentSubpath}` : ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, overflowWrap: "anywhere" }}
                    >
                      <Github size={16} {...ICON} />
                      {repo}
                    </a>
                  </div>
                  {openSub ? (
                    <p className="dx-st dx-st-wait" style={{ marginTop: 10, whiteSpace: "normal" }}>
                      <Clock size={16} {...ICON} />
                      Submission {openSub.githubTag} is {openSub.status === "review" ? "in review" : openSub.status},
                      submitted {timeAgo(openSub.submittedAt)}.
                    </p>
                  ) : null}
                </div>
                <div className="dx-rows-actions">
                  <UpdateExtensionButton
                    slug={ext.slug}
                    extensionName={ext.name}
                    defaultRepoUrl={`https://github.com/${ext.githubRepo}`}
                    defaultSubpath={currentSubpath}
                    hasOpenSubmission={!!openSub}
                    currentVersion={ext.latestVersion?.version ?? null}
                  />
                  <EditExtensionButton
                    slug={ext.slug}
                    extensionName={ext.name}
                    defaultRepo={ext.githubRepo}
                    defaultSubpath={currentSubpath}
                    defaultDescription={ext.description}
                  />
                  {ext.status === "approved" ? (
                    <Link href={`/extension/${ext.slug}`} className="bw-link" style={{ fontSize: 14 }}>
                      Public page
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section style={{ marginTop: 64 }}>
        <h2 className="dx-h2">Recent submissions</h2>
        {recentSubmissions.length === 0 ? (
          <p className="bw-help">No submissions yet. Each one you send appears here with its review status.</p>
        ) : (
          <div className="bw-table-wrap">
            <table className="bw-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Extension</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Ref</th>
                  <th scope="col">Folder</th>
                  <th scope="col">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {recentSubmissions.map((row) => {
                  const sub = row.submissions;
                  const ext = row.extensions;
                  return (
                    <tr key={sub.id}>
                      <td>
                        <Status value={sub.status} />
                      </td>
                      <td>{ext?.name ?? repoName(sub.githubRepo)}</td>
                      <td>{sub.type === "new_extension" ? "New extension" : "Update"}</td>
                      <td>
                        <code className="bw-icode">{sub.githubTag}</code>
                      </td>
                      <td>{sub.subpath ? <code className="bw-icode">{sub.subpath}</code> : "Root"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{timeAgo(sub.submittedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SignedOutView() {
  return (
    <div className="bw-w">
      <div className="dx-msg">
        <h1 className="bw-h2">Sign in to see your extensions.</h1>
        <p>
          The dashboard is where you submit updates and follow the review of the extensions you publish. It uses your
          GitHub account.
        </p>
        <div className="bw-btns">
          <a href="/api/v1/auth/github" className="bw-btn">
            <Github size={16} {...ICON} />
            Sign in with GitHub
          </a>
          <Link href="/" className="bw-btn bw-btn-ghost">
            Back to the directory
          </Link>
        </div>
      </div>
    </div>
  );
}
