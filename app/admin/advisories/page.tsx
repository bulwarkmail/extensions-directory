import type { Metadata } from "next";
import { allAdvisories } from "@/lib/dashboard";
import { formatDate } from "@/lib/utils";
import { Status } from "@/components/status";
import { ActionButton, ActionForm } from "@/components/client/action";

export const metadata: Metadata = { title: "Advisories" };

export default function AdvisoriesPage() {
  const rows = allAdvisories();
  return (
    <div>
      <h1 className="bw-h2">Security advisories</h1>
      <p>Webmails that have an affected version installed show the advisory to their admins (POST /api/v2/updates). Pair a critical one with a yank or a suspension.</p>
      {rows.map(({ a, slug }) => (
        <section key={a.id} className="dx-sec-block">
          <h2 className="bw-h3">{a.id}: {slug} {a.affected}</h2>
          <p className="bw-help">
            {a.withdrawnAt ? <Status value="withdrawn" /> : a.publishedAt ? <Status value="approved" /> : <Status value="draft" />} {a.severity}
            {a.fixedIn ? `, fixed in ${a.fixedIn}` : ""}{a.publishedAt ? `, published ${formatDate(a.publishedAt)}` : ""}
          </p>
          <p>{a.summary}</p>
          <div className="bw-btns">
            {!a.publishedAt && !a.withdrawnAt ? <ActionButton method="PATCH" path={`/admin/advisories/${a.id}`} body={{ publish: true }} label="Publish" small confirm="Publish this advisory? Maintainers are told, and webmails see it." /> : null}
            {!a.withdrawnAt ? <ActionButton method="PATCH" path={`/admin/advisories/${a.id}`} body={{ withdraw: true }} label="Withdraw" ghost small confirm="Withdraw this advisory?" /> : null}
          </div>
        </section>
      ))}
      <section className="dx-sec-block">
        <h2 className="dx-h2">New advisory</h2>
        <ActionForm path="/admin/advisories" submit="Save" fields={[
          { name: "extension", label: "Extension id" },
          { name: "affected", label: "Affected versions", placeholder: ">=1.0.0 <1.2.3", help: "Comparators joined by spaces (and) or || (or)." },
          { name: "fixedIn", label: "Fixed in", optional: true },
          { name: "severity", label: "Severity", type: "select", options: ["low", "medium", "high", "critical"].map((s) => ({ value: s, label: s })) },
          { name: "summary", label: "Summary" },
          { name: "details", label: "Details (Markdown)", type: "textarea", optional: true },
          { name: "publish", label: "Publish now", type: "checkbox" },
        ]} />
      </section>
    </div>
  );
}
