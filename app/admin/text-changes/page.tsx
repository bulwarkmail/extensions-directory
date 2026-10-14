import type { Metadata } from "next";
import { pendingTextChanges } from "@/lib/dashboard";
import { renderMarkdown } from "@/lib/markdown";
import { timeAgo } from "@/lib/utils";
import { ActionButton } from "@/components/client/action";

export const metadata: Metadata = { title: "Text changes" };

export default function TextChangesPage() {
  const rows = pendingTextChanges();
  return (
    <div>
      <h1 className="bw-h2">Text changes</h1>
      <p>Edits to public text after a version was approved. The page shows the old text until a change is approved.</p>
      {rows.length === 0 ? <p className="bw-help">Nothing waiting.</p> : rows.map(({ t, slug, login }) => (
        <section key={t.id} className="dx-sec-block">
          <h2 className="bw-h3">{slug}: {t.field.replace("_", " ")}</h2>
          <p className="bw-help">By @{login}, {timeAgo(t.proposedAt)}</p>
          <div className="dx-split">
            <div><p className="bw-label">Now</p><div className="ext-prose dx-boxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.oldValue ?? "") }} /></div>
            <div><p className="bw-label">Proposed</p><div className="ext-prose dx-boxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.newValue ?? "") }} /></div>
          </div>
          <details className="dx-details"><summary>Proposed source</summary><pre className="bw-code dx-log"><code>{t.newValue}</code></pre></details>
          <div className="bw-btns">
            <ActionButton path={`/admin/text-changes/${t.id}/approve`} label="Approve" />
            <ActionButton path={`/admin/text-changes/${t.id}/reject`} label="Reject" ghost ask="Why? The author gets this." askField="notes" />
          </div>
        </section>
      ))}
    </div>
  );
}
