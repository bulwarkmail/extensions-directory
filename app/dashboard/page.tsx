import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { myExtensions, mySubmissions } from "@/lib/dashboard";
import { formatDate, timeAgo } from "@/lib/utils";
import { ExtIcon, formatTypeLabel } from "@/components/ext-icon";
import { Status } from "@/components/status";
import { ICON } from "@/components/icon";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { DashboardNav } from "@/components/dashboard-nav";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your published extensions and submissions.",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) {
    return <SignInPrompt title="Sign in to see your extensions." text="The dashboard is where you publish versions, set up publishing from CI and follow reviews. It uses your GitHub account." returnTo="/dashboard" />;
  }
  const extensions = myExtensions(user.id);
  const recent = mySubmissions(user.id, 15);

  return (
    <div className="bw-w dx-work">
      <DashboardNav current="/dashboard" />
      <div className="dx-work-head">
        <div>
          <h1 className="bw-h2">Your extensions</h1>
          <p>Publish versions, connect CI and follow the review of every extension you maintain.</p>
        </div>
        <Link href="/dashboard/new" className="bw-btn">
          Add an extension
          <ArrowRight size={16} {...ICON} />
        </Link>
      </div>

      {extensions.length === 0 ? (
        <div className="dx-empty" style={{ paddingTop: 0 }}>
          <h2 className="dx-h2" style={{ marginBottom: 0 }}>You don&apos;t maintain an extension yet.</h2>
          <p>Add one: give its id and the public repository it is built from, then submit a version from the website or from CI.</p>
        </div>
      ) : (
        <ul className="dx-rows">
          {extensions.map(({ ext, role, latest, open }) => (
            <li key={ext.id}>
              <ExtIcon name={ext.name} iconPath={ext.iconPath} />
              <div style={{ minWidth: 0 }}>
                <Link href={`/dashboard/extensions/${ext.slug}`} className="dx-rows-name">{ext.name}</Link>
                <div className="dx-rows-meta">
                  <Status value={ext.status} />
                  {ext.deprecatedAt ? <Status value="deprecated" /> : null}
                  <span>{formatTypeLabel(ext.type, ext.pluginType)}</span>
                  <span>{role === "owner" ? "Owner" : "Maintainer"}</span>
                  {latest ? <span>Version {latest.version}{latest.publishedAt ? `, ${formatDate(latest.publishedAt)}` : ""}</span> : <span>Nothing published yet</span>}
                </div>
                {open.map((s) => (
                  <p key={s.id} className="dx-st dx-st-wait" style={{ marginTop: 10, whiteSpace: "normal" }}>
                    <Clock size={16} {...ICON} />
                    <Link href={`/dashboard/submissions/${s.id}`} className="bw-link">Version {s.version ?? s.githubTag}</Link>: <Status value={s.status} />, submitted {timeAgo(s.submittedAt)}
                  </p>
                ))}
                {ext.status === "suspended" && ext.suspendedReason ? <p className="bw-help bw-help-error">Suspended: {ext.suspendedReason}</p> : null}
              </div>
              <div className="dx-rows-actions">
                <Link href={`/dashboard/extensions/${ext.slug}`} className="bw-btn bw-btn-ghost bw-btn-sm">Manage</Link>
                {ext.status === "approved" ? <Link href={`/extension/${ext.slug}`} className="bw-link" style={{ fontSize: 14 }}>Public page</Link> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <section style={{ marginTop: 64 }}>
        <h2 className="dx-h2">Recent submissions</h2>
        {recent.length === 0 ? (
          <p className="bw-help">Each version you submit appears here with its build and review status.</p>
        ) : (
          <div className="bw-table-wrap">
            <table className="bw-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Extension</th>
                  <th scope="col">Version</th>
                  <th scope="col">From</th>
                  <th scope="col">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(({ s, slug }) => (
                  <tr key={s.id}>
                    <td><Status value={s.status} /></td>
                    <td>{slug ?? s.slug}</td>
                    <td><Link href={`/dashboard/submissions/${s.id}`} className="bw-link">{s.version ?? "?"}{s.dryRun ? " (dry run)" : ""}</Link></td>
                    <td><code className="bw-icode">{s.githubTag}</code> via {s.submittedVia === "oidc" ? "GitHub Actions" : s.submittedVia === "token" ? "API token" : s.submittedVia === "legacy" ? "old site" : "website"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{timeAgo(s.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
