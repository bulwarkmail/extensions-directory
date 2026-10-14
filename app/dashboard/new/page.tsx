import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { DashboardNav } from "@/components/dashboard-nav";
import { NewExtensionForm } from "./form";

export const metadata: Metadata = { title: "Add an extension" };
export const dynamic = "force-dynamic";

export default async function NewExtensionPage() {
  const user = await currentUser();
  if (!user) return <SignInPrompt title="Sign in to add an extension." text="Extensions are published under your GitHub account." returnTo="/dashboard/new" />;
  return (
    <div className="bw-w dx-work">
      <DashboardNav current="/dashboard" />
      <div className="dx-work-head">
        <div>
          <h1 className="bw-h2">Add an extension</h1>
          <p>
            Reserve the extension&apos;s id and say where its source lives. Then submit a version here or from CI. The directory
            builds every version itself from the commit you name, and a reviewer approves it before anyone can install it.
          </p>
        </div>
      </div>
      <NewExtensionForm />
      <p className="bw-help" style={{ marginTop: 24 }}>
        The id must match <code className="bw-icode">id</code> in manifest.json. A name with nothing published is released after 90 days.
      </p>
    </div>
  );
}
