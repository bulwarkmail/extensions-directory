import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { staffPage } from "@/lib/auth/staff";
import { memberRole } from "@/lib/auth/guard";
import { submissionForReview } from "@/lib/dashboard";
import { readStaged } from "@/lib/pipeline/staging";
import { readZipFiles } from "@/lib/pipeline/diff";
import { formatBytes } from "@/lib/utils";
import { SubmissionDetails } from "@/components/submission-details";
import { ActionButton } from "@/components/client/action";
import { AutoRefresh } from "@/components/client/auto-refresh";
import { FileBrowser } from "./files";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await staffPage("reviewer");
  const { id } = await params;
  const data = await submissionForReview(id);
  if (!data) notFound();
  const { s, author, ext } = data;
  // Nobody approves their own work; a super admin may after confirming it (lib/review.ts).
  const maintains = !!s.extensionId && !!(await memberRole(user.id, s.extensionId));
  const own = maintains || s.authorId === user.id;
  const superAdmin = user.role === "super_admin";
  // An approval names the bundle this page shows (artifactSha256); after a rebuild the server refuses it.
  const approveAsk = "Notes for the author (optional). Approving publishes this exact bundle, signed.";
  let files: { name: string; size: number }[] = [];
  if (s.artifactPath) {
    try {
      files = [...(await readZipFiles(await readStaged(s.artifactPath))).entries()].map(([name, d]) => ({ name, size: d.length }));
    } catch {
      files = [];
    }
  }
  const diff = s.diffSummary as { added?: string[]; changed?: string[] } | null;
  const changedFiles = new Set([...(diff?.added ?? []), ...(diff?.changed ?? [])]);
  const reviewable = s.status === "awaiting_review";
  const manifest = s.manifestSnapshot ?? {};
  return (
    <div className="dx-stack">
      <p className="bw-crumb"><Link className="bw-link" href="/admin/submissions">Review queue</Link></p>
      <h1 className="bw-h2">{ext?.name ?? s.slug} {s.version}</h1>
      <p>
        Submitted by <Link className="bw-link" href={`/author/${author?.githubLogin}`}>@{author?.githubLogin}</Link>
        {author?.bannedAt ? <strong> (banned)</strong> : null}
        {ext?.status === "pending" ? ". This is the extension's first version." : ext ? `. Extension status: ${ext.status}.` : null}
      </p>
      <AutoRefresh active={["queued", "building", "publishing"].includes(s.status)} />

      {own ? (
        <p className="bw-note bw-note-warning">
          <strong>{maintains ? "You maintain this extension." : "You submitted this version."}</strong>{" "}
          {superAdmin ? "As a super admin you can still approve it, after confirming that you approve your own work." : "Another reviewer has to approve it."}
        </p>
      ) : null}

      {reviewable ? (
        <div className="bw-btns">
          {!own ? (
            <ActionButton path={`/admin/submissions/${s.id}/approve`} label="Approve and publish" body={{ artifactSha256: s.artifactSha256 }} ask={approveAsk} askField="notes" askRequired={false} />
          ) : superAdmin ? (
            <ActionButton path={`/admin/submissions/${s.id}/approve`} label="Approve your own submission" body={{ selfReview: true, artifactSha256: s.artifactSha256 }} confirm={maintains ? "You maintain this extension. Approve your own submission?" : "You submitted this version. Approve your own submission?"} ask={approveAsk} askField="notes" askRequired={false} />
          ) : null}
          <ActionButton path={`/admin/submissions/${s.id}/reject`} label="Reject" ghost ask="Why? The author gets this." askField="notes" />
          <ActionButton path={`/admin/submissions/${s.id}/rebuild`} label="Build again" ghost confirm="Build this commit again?" />
        </div>
      ) : ["build_failed", "blocked"].includes(s.status) ? (
        <div className="bw-btns">
          <ActionButton path={`/admin/submissions/${s.id}/rebuild`} label="Build again" ghost />
          <ActionButton path={`/admin/submissions/${s.id}/reject`} label="Reject" ghost ask="Why? The author gets this." askField="notes" />
        </div>
      ) : null}

      <SubmissionDetails s={s} />

      <section>
        <h2 className="dx-h2">Manifest</h2>
        <pre className="bw-code dx-log"><code>{JSON.stringify(manifest, null, 2)}</code></pre>
      </section>

      {files.length ? (
        <section>
          <h2 className="dx-h2">Files in the bundle</h2>
          <p className="bw-help">{files.length} files, {formatBytes(files.reduce((n, f) => n + f.size, 0))} unpacked. Changed files are marked; open one to compare it with the previous version.</p>
          <FileBrowser submissionId={s.id} files={files.map((f) => ({ ...f, changed: changedFiles.has(f.name) }))} />
        </section>
      ) : null}
    </div>
  );
}
