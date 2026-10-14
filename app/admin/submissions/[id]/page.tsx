import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authors, submissions, extensions } from "@/lib/db/schema";
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
  const { id } = await params;
  const s = db.select().from(submissions).where(eq(submissions.id, id)).get();
  if (!s) notFound();
  const author = db.select().from(authors).where(eq(authors.id, s.authorId)).get();
  const ext = s.extensionId ? db.select().from(extensions).where(eq(extensions.id, s.extensionId)).get() : null;
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

      {reviewable ? (
        <div className="bw-btns">
          <ActionButton path={`/admin/submissions/${s.id}/approve`} label="Approve and publish" ask="Notes for the author (optional). Approving publishes this exact bundle, signed." askField="notes" askRequired={false} />
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
