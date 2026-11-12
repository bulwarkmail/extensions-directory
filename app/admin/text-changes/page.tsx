import type { Metadata } from "next";
import { staffPage } from "@/lib/auth/staff";
import { memberRole } from "@/lib/auth/guard";
import { pendingTextChanges } from "@/lib/dashboard";
import { renderMarkdown } from "@/lib/markdown";
import { timeAgo } from "@/lib/utils";
import { ActionButton } from "@/components/client/action";

export const metadata: Metadata = { title: "Text changes" };

export default async function TextChangesPage() {
  const user = await staffPage("reviewer");
  const rows = await pendingTextChanges();
  // Nobody approves their own text; a super admin may after confirming it (lib/review.ts).
  const mine = await Promise.all(rows.map(async ({ t }) => ({
    maintains: !!(await memberRole(user.id, t.extensionId)),
    proposed: t.proposedBy === user.id,
  })));
  const superAdmin = user.role === "super_admin";
  return (
    <div>
      <h1 className="bw-h2">Text changes</h1>
      <p>Edits to public text after a version was approved. The page shows the old text until a change is approved.</p>
      {rows.length === 0 ? <p className="bw-help">Nothing waiting.</p> : rows.map(({ t, slug, login }, i) => {
        const { maintains, proposed } = mine[i];
        const own = maintains || proposed;
        const whose = maintains ? "You maintain this extension." : "You proposed this change.";
        return (
          <section key={t.id} className="dx-sec-block">
            <h2 className="bw-h3">{slug}: {t.field.replace("_", " ")}</h2>
            <p className="bw-help">By @{login}, {timeAgo(t.proposedAt)}</p>
            {own ? (
              <p className="bw-note bw-note-warning">
                <strong>{whose}</strong> {superAdmin ? "As a super admin you can still approve it, after confirming that you approve your own text." : "Another reviewer has to approve it."}
              </p>
            ) : null}
            <div className="dx-split">
              <div><p className="bw-label">Now</p><div className="ext-prose dx-boxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.oldValue ?? "") }} /></div>
              <div><p className="bw-label">Proposed</p><div className="ext-prose dx-boxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.newValue ?? "") }} /></div>
            </div>
            <details className="dx-details"><summary>Proposed source</summary><pre className="bw-code dx-log"><code>{t.newValue}</code></pre></details>
            <div className="bw-btns">
              {!own ? (
                <ActionButton path={`/admin/text-changes/${t.id}/approve`} label="Approve" />
              ) : superAdmin ? (
                <ActionButton path={`/admin/text-changes/${t.id}/approve`} label="Approve your own change" body={{ selfReview: true }} confirm={`${whose} Approve your own change?`} />
              ) : null}
              <ActionButton path={`/admin/text-changes/${t.id}/reject`} label="Reject" ghost ask="Why? The author gets this." askField="notes" />
            </div>
          </section>
        );
      })}
    </div>
  );
}
