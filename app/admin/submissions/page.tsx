"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  GitBranch,
  FolderTree,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

interface ScanFinding {
  severity: "block" | "warn" | "info";
  rule: string;
  message: string;
  file?: string;
  line?: number;
  snippet?: string;
}

interface AdminSubmission {
  id: string;
  type: "new_extension" | "new_version";
  status: string;
  extensionName: string;
  version: string;
  declaredType: string;
  repoUrl: string;
  githubRepo: string;
  ref: string;
  subpath: string;
  submittedAt: string | number | null;
  author: {
    displayName: string;
    githubLogin: string;
    avatarUrl: string | null;
  } | null;
  scan: {
    fileCount: number;
    jsFiles: number;
    cssFiles: number;
    warnings: ScanFinding[];
    blockers: ScanFinding[];
  } | null;
}

export default function AdminSubmissionsPage() {
  const [submissions, setSubmissions] = useState<AdminSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function fetchSubmissions() {
    setLoading(true);
    setError(null);
    fetch("/api/v1/admin/submissions")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body;
      })
      .then((data) => {
        setSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setSubmissions([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchSubmissions();
  }, []);

  async function handleAction(
    id: string,
    action: "approve" | "reject",
    reviewNotes?: string
  ) {
    setActionInProgress(id);
    setActionError(null);
    try {
      const res = await fetch("/api/v1/admin/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: id, action, reviewNotes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      fetchSubmissions();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionInProgress(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            Pending Submissions
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Review extension submissions before they go live in the directory.
          </p>
        </div>
        <button
          onClick={fetchSubmissions}
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-[13px]">Loading submissions…</span>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && submissions.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-muted/30 py-12 text-center">
          <p className="text-[14px] font-medium text-foreground">
            No pending submissions
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            New submissions will appear here for review.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {submissions.map((sub) => (
          <SubmissionCard
            key={sub.id}
            submission={sub}
            actionInProgress={actionInProgress === sub.id}
            onAction={handleAction}
          />
        ))}
      </div>
    </div>
  );
}

function SubmissionCard({
  submission,
  actionInProgress,
  onAction,
}: {
  submission: AdminSubmission;
  actionInProgress: boolean;
  onAction: (
    id: string,
    action: "approve" | "reject",
    reviewNotes?: string
  ) => void;
}) {
  const sub = submission;
  const blockers = sub.scan?.blockers ?? [];
  const warnings = sub.scan?.warnings ?? [];

  return (
    <div className="rounded-md border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground text-[15px] truncate">
              {sub.extensionName}
            </h3>
            {sub.version && (
              <span className="text-[12px] text-muted-foreground font-mono">
                v{sub.version}
              </span>
            )}
            <span
              className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${
                sub.type === "new_extension"
                  ? "bg-primary/10 text-primary"
                  : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              }`}
            >
              {sub.type === "new_extension" ? "new" : "update"}
            </span>
            {sub.declaredType && (
              <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
                {sub.declaredType}
              </span>
            )}
          </div>

          {sub.author && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              by{" "}
              <span className="text-foreground font-medium">
                {sub.author.displayName}
              </span>{" "}
              <span className="font-mono">@{sub.author.githubLogin}</span>
            </p>
          )}

          <div className="mt-3 flex items-center gap-3 flex-wrap text-[12px]">
            <a
              href={sub.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
            >
              {sub.githubRepo}
              <ExternalLink className="w-3 h-3" />
            </a>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <GitBranch className="w-3 h-3" />
              <span className="font-mono">{sub.ref}</span>
            </span>
            {sub.subpath && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <FolderTree className="w-3 h-3" />
                <span className="font-mono">{sub.subpath}/</span>
              </span>
            )}
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            Submitted {formatDate(sub.submittedAt as string)}
          </p>

          {sub.scan && (
            <div className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>
                  Scanned{" "}
                  <strong className="text-foreground">
                    {sub.scan.fileCount}
                  </strong>{" "}
                  files · {sub.scan.jsFiles} JS · {sub.scan.cssFiles} CSS
                </span>
                {blockers.length > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 text-destructive font-medium">
                    <X className="w-3 h-3" />
                    {blockers.length} blocking
                  </span>
                )}
                {warnings.length > 0 && blockers.length === 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 text-warning font-medium">
                    <AlertTriangle className="w-3 h-3" />
                    {warnings.length} warning{warnings.length === 1 ? "" : "s"}
                  </span>
                )}
                {blockers.length === 0 && warnings.length === 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 text-success font-medium">
                    <Check className="w-3 h-3" />
                    clean
                  </span>
                )}
              </div>
              {(blockers.length > 0 || warnings.length > 0) && (
                <FindingsList
                  blockers={blockers}
                  warnings={warnings}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={() => onAction(sub.id, "approve")}
            disabled={actionInProgress}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-success text-success-foreground text-[13px] font-medium hover:bg-success/90 disabled:opacity-50 transition-colors"
          >
            {actionInProgress ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Approve
          </button>
          <button
            onClick={() => {
              const reason = prompt("Rejection reason:");
              if (reason) onAction(sub.id, "reject", reason);
            }}
            disabled={actionInProgress}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-card border border-border text-foreground text-[13px] font-medium hover:bg-destructive/10 hover:border-destructive/40 hover:text-destructive disabled:opacity-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function FindingsList({
  blockers,
  warnings,
}: {
  blockers: ScanFinding[];
  warnings: ScanFinding[];
}) {
  return (
    <ul className="mt-2 space-y-1.5">
      {blockers.map((f, i) => (
        <FindingRow key={`b-${i}`} finding={f} tone="block" />
      ))}
      {warnings.map((f, i) => (
        <FindingRow key={`w-${i}`} finding={f} tone="warn" />
      ))}
    </ul>
  );
}

function FindingRow({
  finding: f,
  tone,
}: {
  finding: ScanFinding;
  tone: "block" | "warn";
}) {
  return (
    <li
      className={`flex items-start gap-2 px-2 py-1.5 rounded-sm text-[12px] ${
        tone === "block"
          ? "bg-destructive/5 border border-destructive/20"
          : "bg-warning/5 border border-warning/20"
      }`}
    >
      <code className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm bg-card border border-border text-foreground shrink-0">
        {f.rule}
      </code>
      <div className="min-w-0 flex-1">
        <p className="text-foreground">{f.message}</p>
        {(f.file || f.line) && (
          <p className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">
            {f.file}
            {f.line ? `:${f.line}` : ""}
          </p>
        )}
        {f.snippet && (
          <pre className="mt-1 px-2 py-1 rounded-sm bg-muted/60 text-[10px] font-mono text-muted-foreground overflow-x-auto">
            {f.snippet}
          </pre>
        )}
      </div>
    </li>
  );
}
