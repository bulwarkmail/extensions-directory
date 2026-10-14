import Link from "next/link";
import type { Metadata } from "next";
import { allExtensions } from "@/lib/dashboard";
import { formatDate } from "@/lib/utils";
import { Status } from "@/components/status";
import { ActionButton } from "@/components/client/action";

export const metadata: Metadata = { title: "Extensions" };

export default function AdminExtensions() {
  const rows = allExtensions();
  return (
    <div>
      <h1 className="bw-h2">Extensions</h1>
      <p>Open an extension to yank a version, change owners or edit its listing; staff can manage every extension.</p>
      <div className="bw-table-wrap">
        <table className="bw-table">
          <thead><tr><th scope="col">Extension</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Source</th><th scope="col">Downloads</th><th scope="col">Updated</th><th scope="col"><span className="bw-muted">Actions</span></th></tr></thead>
          <tbody>
            {rows.map(({ e, login }) => (
              <tr key={e.id}>
                <td><Link className="bw-link" href={`/dashboard/extensions/${e.slug}`}>{e.name}</Link> <code className="bw-icode">{e.slug}</code>{e.featured ? " ★" : ""}</td>
                <td><Status value={e.status} />{e.deprecatedAt ? <Status value="deprecated" /> : null}{e.suspendedReason ? <div className="bw-help">{e.suspendedReason}</div> : null}</td>
                <td>@{login}</td>
                <td style={{ overflowWrap: "anywhere" }}>{e.sourceHost}/{e.githubRepo}{e.subpath ? `/${e.subpath}` : ""}</td>
                <td className="num">{e.totalDownloads ?? 0}</td>
                <td style={{ whiteSpace: "nowrap" }}>{e.updatedAt ? formatDate(e.updatedAt) : ""}</td>
                <td>
                  <div className="dx-rowact">
                    {e.status === "suspended"
                      ? <ActionButton path={`/admin/extensions/${e.slug}`} body={{ action: "unsuspend" }} label="Unsuspend" ghost small />
                      : <ActionButton path={`/admin/extensions/${e.slug}`} body={{ action: "suspend" }} label="Suspend" ghost small ask="Why? Suspending stops all downloads and withdraws open submissions." />}
                    <ActionButton path={`/admin/extensions/${e.slug}`} body={{ action: e.featured ? "unfeature" : "feature" }} label={e.featured ? "Unfeature" : "Feature"} ghost small />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
