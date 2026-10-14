import Link from "next/link";
import type { Metadata } from "next";
import { adminCounts } from "@/lib/dashboard";

export const metadata: Metadata = { title: "Admin" };

export default function AdminOverview() {
  const c = adminCounts();
  const tiles = [
    { href: "/admin/submissions", n: c.awaitingReview, label: "versions waiting for review" },
    { href: "/admin/submissions?status=building", n: c.building, label: "builds queued or running" },
    { href: "/admin/text-changes", n: c.textChanges, label: "text changes waiting for review" },
    { href: "/admin/reports", n: c.openReports, label: "open abuse reports" },
    { href: "/admin/extensions", n: c.extensions, label: "listed extensions" },
    { href: "/admin/authors", n: c.authors, label: "accounts" },
  ];
  return (
    <div>
      <h1 className="bw-h2">Overview</h1>
      {c.unsigned ? <p className="bw-note bw-note-warning">{c.unsigned} published versions have no directory signature. The worker signs them when it has a signing key (SIGNING_KEY_FILE).</p> : null}
      <div className="bw-tiles bw-tiles-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="bw-tile">
            <span className="bw-tile-title">{t.n}</span>
            <span className="bw-tile-text">{t.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
