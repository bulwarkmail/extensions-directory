import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { myExtensions, myTokens } from "@/lib/dashboard";
import { formatDate, timeAgo } from "@/lib/utils";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { DashboardNav } from "@/components/dashboard-nav";
import { Status } from "@/components/status";
import { ActionButton } from "@/components/client/action";
import { NewTokenForm } from "./form";

export const metadata: Metadata = { title: "API tokens" };
export const dynamic = "force-dynamic";

export default async function TokensPage() {
  const user = await currentUser();
  if (!user) return <SignInPrompt title="Sign in to manage API tokens." text="Tokens let CI outside GitHub, or a script, submit versions." returnTo="/dashboard/tokens" />;
  const tokens = myTokens(user.id);
  const exts = myExtensions(user.id).map((e) => ({ slug: e.ext.slug, name: e.ext.name }));
  return (
    <div className="bw-w dx-work">
      <DashboardNav current="/dashboard/tokens" />
      <div className="dx-work-head">
        <div>
          <h1 className="bw-h2">API tokens</h1>
          <p>For GitLab CI, Forgejo Actions or a script. On GitHub, prefer trusted publishing: it needs no token at all.</p>
        </div>
      </div>
      {tokens.length ? (
        <div className="bw-table-wrap">
          <table className="bw-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Token</th><th scope="col">Can</th><th scope="col">Extensions</th><th scope="col">Expires</th><th scope="col">Last used</th><th scope="col"><span className="bw-muted">Actions</span></th></tr></thead>
            <tbody>
              {tokens.map((t) => {
                const expired = t.expired;
                return (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td><code className="bw-icode">{t.prefix}…</code></td>
                    <td>{t.scopes.join(", ").replace("dry_run", "dry run")}</td>
                    <td>{t.extensions.join(", ")}</td>
                    <td>{t.revokedAt ? <Status value="revoked" /> : expired ? <Status value="expired" /> : formatDate(t.expiresAt)}</td>
                    <td>{t.lastUsedAt ? timeAgo(t.lastUsedAt) : "never"}</td>
                    <td>{t.revokedAt || expired ? null : <ActionButton method="DELETE" path={`/tokens/${t.id}`} label="Revoke" ghost small confirm={`Revoke "${t.name}"? Anything using it stops working at once.`} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <section className="dx-sec-block">
        <h2 className="dx-h2">New token</h2>
        {exts.length ? <NewTokenForm extensions={exts} /> : <p className="bw-help">Add an extension first; tokens are scoped to extensions.</p>}
      </section>
    </div>
  );
}
