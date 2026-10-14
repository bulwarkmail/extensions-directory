import { currentUser, hasRole } from "@/lib/auth/session";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { AdminNav } from "./nav";

export const dynamic = "force-dynamic";

const ROLE_LABEL = { author: "author", reviewer: "reviewer", admin: "admin", super_admin: "super admin" } as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user || !hasRole(user.role, "reviewer")) {
    return <SignInPrompt title="Staff access required." text="Sign in with the GitHub account of a directory reviewer or admin to open this page." returnTo="/admin" />;
  }
  return (
    <div className="bw-w dx-work">
      <div className="dx-admin">
        <aside>
          <p className="dx-admin-who">Signed in as @{user.githubLogin}, {ROLE_LABEL[user.role]}.</p>
          <AdminNav admin={hasRole(user.role, "admin")} />
        </aside>
        <div style={{ minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
