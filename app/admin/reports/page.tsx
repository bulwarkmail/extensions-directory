import Link from "next/link";
import type { Metadata } from "next";
import { allReports } from "@/lib/dashboard";
import { timeAgo } from "@/lib/utils";
import { Status } from "@/components/status";
import { ActionButton } from "@/components/client/action";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status ?? "open";
  const rows = allReports(status);
  return (
    <div>
      <h1 className="bw-h2">Abuse reports</h1>
      <nav className="dx-tabs" aria-label="Filter">
        {["open", "actioned", "dismissed", "all"].map((s) => <Link key={s} className="dx-tab" href={`/admin/reports?status=${s}`} aria-current={status === s ? "page" : undefined}>{s}</Link>)}
      </nav>
      {rows.length === 0 ? <p className="bw-help">No reports.</p> : rows.map(({ r, slug }) => (
        <section key={r.id} className="dx-sec-block">
          <h2 className="bw-h3"><Link className="bw-link" href={`/extension/${slug}`}>{slug}</Link>{r.version ? ` ${r.version}` : ""}: {r.reason}</h2>
          <p className="bw-help"><Status value={r.status} /> {timeAgo(r.createdAt)}{r.duplicates ? `, repeated ${r.duplicates} times` : ""}{r.reporterId ? ", from a signed-in account" : ", anonymous"}{r.contactEmail ? `, contact ${r.contactEmail}` : ""}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{r.details}</p>
          {r.notes ? <p className="bw-help">Notes: {r.notes}</p> : null}
          <div className="bw-btns">
            {r.status !== "actioned" ? <ActionButton path={`/admin/reports/${r.id}`} body={{ status: "actioned" }} label="Mark actioned" ghost small ask="What was done? (yank, suspension, advisory…)" askField="notes" askRequired={false} /> : null}
            {r.status !== "dismissed" ? <ActionButton path={`/admin/reports/${r.id}`} body={{ status: "dismissed" }} label="Dismiss" ghost small ask="Why dismissed? (optional)" askField="notes" askRequired={false} /> : null}
          </div>
        </section>
      ))}
    </div>
  );
}
