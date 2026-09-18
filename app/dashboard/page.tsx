import Link from "next/link";
import {
  CheckCircle2,
  Github,
  LayoutDashboard,
  Palette,
  Puzzle,
  Upload,
} from "lucide-react";
import type { Metadata } from "next";
import { getAuthorSession } from "@/lib/auth";
import {
  getAuthorByGithubId,
  getExtensionsByAuthorId,
  getSubmissionsByAuthorId,
} from "@/lib/db/queries";
import { PageHeader } from "@/components/page-header";
import { formatDate, timeAgo } from "@/lib/utils";
import { UpdateExtensionButton } from "@/components/update-extension-button";
import { EditExtensionButton } from "@/components/edit-extension-button";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your published extensions and submissions.",
};

const EXT_STATUS_TONE: Record<string, string> = {
  approved: "bg-success/10 text-success border-success/30",
  pending: "bg-warning/10 text-warning border-warning/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  suspended: "bg-destructive/10 text-destructive border-destructive/30",
  archived: "bg-muted text-muted-foreground border-border",
};

const SUB_STATUS_TONE: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/30",
  scanning: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  review: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  approved: "bg-success/10 text-success border-success/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
};

export default async function DashboardPage() {
  const session = await getAuthorSession();

  if (!session.authorId || !session.githubId) {
    return <SignedOutView />;
  }

  const author = await getAuthorByGithubId(session.githubId);
  if (!author || author.banned) {
    return <SignedOutView />;
  }

  const [extensions, recentSubmissions] = await Promise.all([
    getExtensionsByAuthorId(author.id),
    getSubmissionsByAuthorId(author.id, 10),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <LayoutDashboard className="w-3 h-3" />
            Dashboard
          </>
        }
        title={`Welcome back,`}
        titleAccent={`${author.displayName}.`}
        description="Manage your published extensions, push updates, and track submission status."
      >
        <Link
          href="/submit"
          className="ed-cta-primary"
          style={{ padding: "12px 20px", fontSize: 14 }}
        >
          <Upload className="w-4 h-4" />
          Submit new extension
        </Link>
      </PageHeader>

      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-14 py-10 sm:py-14 space-y-14">
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-[15px] font-semibold text-foreground">
              Your extensions{" "}
              <span className="text-muted-foreground font-normal">
                ({extensions.length})
              </span>
            </h2>
          </div>

          {extensions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/30 py-12 text-center">
              <p className="text-[14px] font-medium text-foreground">
                No extensions yet
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Submit your first plugin or theme to get started.
              </p>
              <Link
                href="/submit"
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Submit an extension
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {extensions.map((ext) => {
                const Icon = ext.type === "plugin" ? Puzzle : Palette;
                const iconTint =
                  ext.type === "plugin"
                    ? "bg-primary/10 text-primary"
                    : "bg-violet-500/10 text-violet-500";
                const statusTone =
                  EXT_STATUS_TONE[ext.status] ?? EXT_STATUS_TONE.archived;

                const lastSub = ext.lastSubmission;
                const openSub = ext.openSubmission;
                const currentSubpath = ext.subpath ?? lastSub?.subpath ?? "";

                return (
                  <li
                    key={ext.id}
                    className="rounded-md border border-border bg-card p-4 sm:p-5"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${iconTint}`}
                      >
                        {ext.iconPath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/v1/files/${ext.iconPath}`}
                            alt={ext.name}
                            className="h-9 w-9 rounded-sm object-cover"
                          />
                        ) : (
                          <Icon className="w-5 h-5" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={`/extension/${ext.slug}`}
                            className="font-semibold text-foreground text-[14px] hover:text-primary transition-colors truncate"
                          >
                            {ext.name}
                          </Link>
                          <span
                            className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${statusTone}`}
                          >
                            {ext.status}
                          </span>
                          <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
                            {ext.type}
                          </span>
                          {ext.latestVersion && (
                            <span className="font-mono text-[12px] text-muted-foreground">
                              v{ext.latestVersion.version}
                            </span>
                          )}
                        </div>

                        <p className="mt-1 text-[12px] text-muted-foreground line-clamp-1">
                          {ext.description}
                        </p>

                        <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                          <a
                            href={`https://github.com/${ext.githubRepo}${currentSubpath ? `/tree/HEAD/${currentSubpath}` : ""}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                          >
                            <Github className="w-3 h-3" />
                            {ext.githubRepo}
                            {currentSubpath && (
                              <span className="font-mono text-foreground/55">
                                /{currentSubpath}
                              </span>
                            )}
                          </a>
                          {ext.latestVersion?.publishedAt && (
                            <span>
                              Published{" "}
                              {formatDate(ext.latestVersion.publishedAt)}
                            </span>
                          )}
                          <span className="font-mono">/{ext.slug}</span>
                        </div>

                        {openSub && (
                          <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-warning bg-warning/10 border border-warning/30 px-2 py-1 rounded-sm">
                            <CheckCircle2 className="w-3 h-3" />
                            Submission {openSub.githubTag} is{" "}
                            <strong>{openSub.status}</strong> — submitted{" "}
                            {timeAgo(openSub.submittedAt)}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <UpdateExtensionButton
                          slug={ext.slug}
                          extensionName={ext.name}
                          defaultRepoUrl={`https://github.com/${ext.githubRepo}`}
                          defaultSubpath={currentSubpath}
                          hasOpenSubmission={!!openSub}
                          currentVersion={ext.latestVersion?.version ?? null}
                        />
                        <EditExtensionButton
                          slug={ext.slug}
                          extensionName={ext.name}
                          defaultRepo={ext.githubRepo}
                          defaultSubpath={currentSubpath}
                          defaultDescription={ext.description}
                        />
                        <Link
                          href={`/extension/${ext.slug}`}
                          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          View public page →
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-[15px] font-semibold text-foreground mb-4">
            Recent submissions
          </h2>
          {recentSubmissions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/30 py-8 text-center text-[13px] text-muted-foreground">
              No submissions yet.
            </div>
          ) : (
            <ul className="rounded-md border border-border bg-card divide-y divide-border/60 overflow-hidden">
              {recentSubmissions.map((row) => {
                const sub = row.submissions;
                const ext = row.extensions;
                const tone =
                  SUB_STATUS_TONE[sub.status] ?? SUB_STATUS_TONE.pending;
                return (
                  <li
                    key={sub.id}
                    className="px-4 py-3 flex items-center gap-3 flex-wrap text-[12px]"
                  >
                    <span
                      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${tone}`}
                    >
                      {sub.status}
                    </span>
                    <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
                      {sub.type === "new_extension" ? "new" : "update"}
                    </span>
                    <span className="font-medium text-foreground truncate">
                      {ext?.name ?? sub.githubRepo}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {sub.githubTag}
                    </span>
                    {sub.subpath && (
                      <span className="font-mono text-muted-foreground">
                        /{sub.subpath}
                      </span>
                    )}
                    <span className="ml-auto text-muted-foreground">
                      {timeAgo(sub.submittedAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SignedOutView() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary mb-4">
        <LayoutDashboard className="w-6 h-6" />
      </span>
      <h1
        className="text-2xl font-bold text-foreground tracking-tight"
        style={{ fontFamily: "var(--font-exo2)" }}
      >
        Sign in to view your dashboard
      </h1>
      <p className="mt-2 text-[14px] text-muted-foreground max-w-sm">
        The dashboard lets you push updates and track the review status of your
        published extensions.
      </p>
      <div className="mt-5 flex flex-col sm:flex-row items-center gap-3">
        <a
          href="/api/v1/auth/github"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-foreground text-background font-medium text-sm hover:bg-foreground/90 transition-colors"
        >
          <Github className="w-4 h-4" />
          Sign in with GitHub
        </a>
        <Link
          href="/"
          className="inline-flex items-center px-5 py-2.5 rounded-md border border-border bg-card text-foreground font-medium text-sm hover:bg-muted/50 hover:border-primary/30 transition-colors"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
