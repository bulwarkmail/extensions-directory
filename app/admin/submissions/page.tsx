import Link from "next/link";
import type { Metadata } from "next";
import { reviewQueue } from "@/lib/dashboard";
import { timeAgo } from "@/lib/utils";
import { Status } from "@/components/status";

export const metadata: Metadata = { title: "Review queue" };

const FILTERS = [
  { value: "awaiting_review", label: "Waiting for review" },
  { value: "building", label: "Building" },
  { value: "queued", label: "Queued" },
  { value: "build_failed", label: "Build failed" },
  { value: "blocked", label: "Blocked" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status ?? "awaiting_review";
  const rows = reviewQueue(status);
  return (
    <div>
      <h1 className="bw-h2">Review queue</h1>
      <nav className="dx-tabs" aria-label="Filter">
        {FILTERS.map((f) => (
          <Link key={f.value} href={`/admin/submissions?status=${f.value}`} className="dx-tab" aria-current={status === f.value ? "page" : undefined}>{f.label}</Link>
        ))}
      </nav>
      {rows.length === 0 ? <p className="bw-help">Nothing here.</p> : (
        <div className="bw-table-wrap">
          <table className="bw-table">
            <thead><tr><th scope="col">Extension</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">By</th><th scope="col">Via</th><th scope="col">Submitted</th></tr></thead>
            <tbody>
              {rows.map(({ s, login, name, extStatus }) => (
                <tr key={s.id}>
                  <td><Link className="bw-link" href={`/admin/submissions/${s.id}`}>{name ?? s.slug}</Link>{extStatus === "pending" ? <span className="bw-muted"> (new)</span> : null}</td>
                  <td>{s.version}</td>
                  <td><Status value={s.status} /></td>
                  <td>@{login}</td>
                  <td>{s.submittedVia}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{timeAgo(s.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
