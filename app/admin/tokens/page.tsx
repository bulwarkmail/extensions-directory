import type { Metadata } from "next";
import { currentUser, hasRole } from "@/lib/auth/session";
import { allTokens } from "@/lib/dashboard";
import { formatDate, timeAgo } from "@/lib/utils";
import { Status } from "@/components/status";
import { ActionButton } from "@/components/client/action";

export const metadata: Metadata = { title: "API tokens" };

export default async function AdminTokens() {
  const user = await currentUser();
  if (!user || !hasRole(user.role, "admin")) return <p>Admins only.</p>;
  const rows = allTokens();
  return (
    <div>
      <h1 className="bw-h2">API tokens</h1>
      <div className="bw-table-wrap">
        <table className="bw-table">
          <thead><tr><th scope="col">Token</th><th scope="col">Owner</th><th scope="col">Scopes</th><th scope="col">Expires</th><th scope="col">Last used</th><th scope="col"><span className="bw-muted">Actions</span></th></tr></thead>
          <tbody>
            {rows.map(({ t, login }) => (
              <tr key={t.id}>
                <td>{t.name} <code className="bw-icode">{t.prefix}…</code></td>
                <td>@{login}</td>
                <td>{t.scopes.join(", ")}</td>
                <td>{t.revokedAt ? <Status value="revoked" /> : formatDate(t.expiresAt)}</td>
                <td>{t.lastUsedAt ? timeAgo(t.lastUsedAt) : "never"}</td>
                <td>{t.revokedAt ? null : <ActionButton path={`/admin/tokens/${t.id}/revoke`} label="Revoke" ghost small ask="Why? The owner is told." />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
