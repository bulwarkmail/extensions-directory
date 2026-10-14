import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { submissionFor } from "@/lib/dashboard";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { DashboardNav } from "@/components/dashboard-nav";
import { SubmissionDetails } from "@/components/submission-details";
import { AutoRefresh } from "@/components/client/auto-refresh";
import { ActionButton } from "@/components/client/action";

export const metadata: Metadata = { title: "Submission" };
export const dynamic = "force-dynamic";

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return <SignInPrompt title="Sign in to see this submission." text="Submissions are visible to the extension's maintainers and reviewers." returnTo={`/dashboard/submissions/${id}`} />;
  const data = await submissionFor(id, user);
  if (!data) notFound();
  const { s, ext } = data;
  const running = ["queued", "building", "publishing"].includes(s.status);
  const withdrawable = ["queued", "awaiting_review", "build_failed", "blocked"].includes(s.status) && !!ext;
  return (
    <div className="bw-w dx-work">
      <DashboardNav current="/dashboard" />
      <div className="dx-work-head">
        <div>
          <p className="bw-crumb">{ext ? <Link className="bw-link" href={`/dashboard/extensions/${ext.slug}`}>{ext.name}</Link> : null}</p>
          <h1 className="bw-h2">{s.dryRun ? "Dry run" : "Submission"} of {s.slug} {s.version}</h1>
        </div>
        {withdrawable && ext ? <ActionButton method="DELETE" path={`/extensions/${ext.slug}/submissions/${s.id}`} label="Withdraw" ghost confirm="Withdraw this submission?" /> : null}
      </div>
      <AutoRefresh active={running} />
      {s.status === "awaiting_review" ? <p className="bw-note">Built and checked. A reviewer looks at it next; you get an email with the result.</p> : null}
      <SubmissionDetails s={s} />
    </div>
  );
}
