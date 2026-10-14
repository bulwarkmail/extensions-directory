import Link from "next/link";
import type { Metadata } from "next";
import { currentUser, hasRole } from "@/lib/auth/session";
import { auditEntries } from "@/lib/dashboard";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; target?: string; page?: string }> }) {
  const user = await currentUser();
  if (!user || !hasRole(user.role, "admin")) return <p>Admins only.</p>;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const rows = auditEntries({ action: sp.action, target: sp.target, page });
  return (
    <div>
      <h1 className="bw-h2">Audit log</h1>
      <form className="dx-toolbar-form" action="/admin/audit">
        <input className="bw-input" name="action" defaultValue={sp.action} placeholder="action, e.g. submission. or author.ban" aria-label="Action" />
        <input className="bw-input" name="target" defaultValue={sp.target} placeholder="target id" aria-label="Target id" />
        <button className="bw-btn bw-btn-ghost" type="submit">Filter</button>
      </form>
      <div className="bw-table-wrap">
        <table className="bw-table">
          <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Target</th><th scope="col">Details</th></tr></thead>
          <tbody>
            {rows.map(({ l, login }) => (
              <tr key={l.id}>
                <td style={{ whiteSpace: "nowrap" }}>{l.at?.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{l.actorKind}{login ? ` @${login}` : l.actorId ? ` ${l.actorId}` : ""}</td>
                <td><code className="bw-icode">{l.action}</code></td>
                <td>{l.targetKind} {l.targetId ? <Link className="bw-link" href={`/admin/audit?target=${l.targetId}`}>{l.targetId.slice(0, 12)}</Link> : null}</td>
                <td><code className="bw-icode" style={{ overflowWrap: "anywhere" }}>{JSON.stringify(l.details)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bw-btns">
        {page > 1 ? <Link className="bw-btn bw-btn-ghost" href={`/admin/audit?page=${page - 1}${sp.action ? `&action=${sp.action}` : ""}`}>Newer</Link> : null}
        {rows.length === 100 ? <Link className="bw-btn bw-btn-ghost" href={`/admin/audit?page=${page + 1}${sp.action ? `&action=${sp.action}` : ""}`}>Older</Link> : null}
      </div>
    </div>
  );
}
