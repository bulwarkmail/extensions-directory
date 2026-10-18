import Link from "next/link";
import type { Metadata } from "next";
import { currentUser, hasRole } from "@/lib/auth/session";
import { allAuthors } from "@/lib/dashboard";
import { formatDate } from "@/lib/utils";
import { Status } from "@/components/status";
import { ActionButton } from "@/components/client/action";

export const metadata: Metadata = { title: "Authors" };

export default async function AdminAuthors({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await currentUser();
  if (!user || !hasRole(user.role, "admin")) return <p>Admins only.</p>;
  const q = (await searchParams).q;
  const rows = allAuthors(q);
  return (
    <div>
      <h1 className="bw-h2">Accounts</h1>
      <form className="dx-toolbar-form" action="/admin/authors">
        <input className="bw-input" name="q" defaultValue={q} placeholder="GitHub login" aria-label="Search by GitHub login" />
        <button className="bw-btn bw-btn-ghost" type="submit">Search</button>
      </form>
      <div className="bw-table-wrap">
        <table className="bw-table">
          <thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Joined</th><th scope="col"><span className="bw-muted">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link className="bw-link" href={`/author/${a.githubLogin}`}>@{a.githubLogin}</Link>{a.verified ? " ✓" : ""}
                  <div className="bw-help">{a.members ? `Members: ${a.members.map((m) => `@${m.login}${m.role === "owner" ? " (owner)" : ""}`).join(", ") || "none"}` : a.email}</div>
                </td>
                <td>{a.kind === "org" ? "Organization" : a.role.replace("_", " ")}</td>
                <td>{a.bannedAt ? <><Status value="banned" /><div className="bw-help">{a.bannedReason}</div></> : <Status value="active" />}</td>
                <td style={{ whiteSpace: "nowrap" }}>{a.createdAt ? formatDate(a.createdAt) : ""}</td>
                <td>
                  <div className="dx-rowact">
                    {a.bannedAt
                      ? <ActionButton path={`/admin/authors/${a.id}`} body={{ action: "unban" }} label="Unban" ghost small />
                      : a.id !== user.id ? <ActionButton path={`/admin/authors/${a.id}`} body={{ action: "ban" }} label="Ban" ghost small ask="Why? Banning ends their sessions, revokes their tokens and withdraws their open submissions." /> : null}
                    <ActionButton path={`/admin/authors/${a.id}`} body={{ action: a.verified ? "unverify" : "verify" }} label={a.verified ? "Unverify" : "Verify"} ghost small />
                    {user.role === "super_admin" && a.id !== user.id && a.kind !== "org" ? (
                      <ActionButton path={`/admin/authors/${a.id}`} body={{ action: "role" }} label="Change role" ghost small ask="New role: author, reviewer, admin or super_admin" askField="role" />
                    ) : null}
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
