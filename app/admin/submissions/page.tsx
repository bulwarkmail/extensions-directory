"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, CircleCheck, CircleX, TriangleAlert, X } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ICON } from "@/components/icon";
import { ScanFindings, type ScanFinding } from "@/components/scan-findings";
import { formatTypeLabel } from "@/components/ext-icon";

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

  async function handleAction(id: string, action: "approve" | "reject", reviewNotes?: string) {
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
    <div>
      <div className="dx-work-head" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="bw-h2">Submissions</h1>
          <p>Review each submission before it goes live in the directory.</p>
        </div>
        <button type="button" onClick={fetchSubmissions} className="bw-btn bw-btn-ghost bw-btn-sm" disabled={loading}>
          {loading ? "Loading…" : "Refresh the list"}
        </button>
      </div>

      {actionError ? (
        <div className="bw-note dx-note-bad" role="alert" style={{ marginBottom: 24 }}>
          <span className="dx-note-lead">
            <CircleX size={16} {...ICON} />
            The action failed.
          </span>{" "}
          {actionError}
        </div>
      ) : null}

      {loading && submissions.length === 0 ? (
        <p className="bw-help" aria-live="polite">
          Loading submissions…
        </p>
      ) : null}

      {error && !loading ? (
        <div className="bw-note dx-note-bad" role="alert">
          <span className="dx-note-lead">
            <CircleX size={16} {...ICON} />
            The queue did not load.
          </span>{" "}
          {error}
        </div>
      ) : null}

      {!loading && !error && submissions.length === 0 ? (
        <p className="bw-help">No submissions are waiting. New ones appear here for review.</p>
      ) : null}

      {submissions.length > 0 ? (
        <ul className="dx-rows">
          {submissions.map((sub) => (
            <SubmissionRow
              key={sub.id}
              submission={sub}
              actionInProgress={actionInProgress === sub.id}
              onAction={handleAction}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SubmissionRow({
  submission: sub,
  actionInProgress,
  onAction,
}: {
  submission: AdminSubmission;
  actionInProgress: boolean;
  onAction: (id: string, action: "approve" | "reject", reviewNotes?: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const blockers = sub.scan?.blockers ?? [];
  const warnings = sub.scan?.warnings ?? [];
  const reasonId = `reject-${sub.id}`;

  return (
    <li style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
      <div style={{ minWidth: 0 }}>
        <h2 className="dx-rows-name">
          {sub.extensionName}
          {sub.version ? ` ${sub.version}` : ""}
        </h2>
        <div className="dx-rows-meta">
          <span>{sub.type === "new_extension" ? "New extension" : "Update"}</span>
          {sub.declaredType ? (
            <span>{formatTypeLabel(sub.declaredType === "theme" ? "theme" : "plugin", sub.declaredType)}</span>
          ) : null}
          {sub.author ? (
            <span>
              by {sub.author.displayName} (@{sub.author.githubLogin})
            </span>
          ) : null}
          <span>Submitted {formatDate(sub.submittedAt as string)}</span>
        </div>
        <div className="dx-rows-meta">
          <a href={sub.repoUrl} target="_blank" rel="noopener noreferrer" className="bw-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {sub.githubRepo}
            <ArrowUpRight size={16} {...ICON} />
          </a>
          <span>
            Ref <code className="bw-icode">{sub.ref}</code>
          </span>
          {sub.subpath ? (
            <span>
              Folder <code className="bw-icode">{sub.subpath}</code>
            </span>
          ) : null}
        </div>

        {sub.scan ? (
          <div style={{ marginTop: 14 }}>
            <p className="dx-rows-meta" style={{ marginTop: 0 }}>
              {blockers.length > 0 ? (
                <span className="dx-st dx-st-bad">
                  <CircleX size={16} {...ICON} />
                  {blockers.length} blocking
                </span>
              ) : warnings.length > 0 ? (
                <span className="dx-st dx-st-wait">
                  <TriangleAlert size={16} {...ICON} />
                  {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
                </span>
              ) : (
                <span className="dx-st dx-st-ok">
                  <CircleCheck size={16} {...ICON} />
                  Clean scan
                </span>
              )}
              <span>
                {sub.scan.fileCount} files: {sub.scan.jsFiles} JavaScript, {sub.scan.cssFiles} CSS
              </span>
            </p>
            {blockers.length + warnings.length > 0 ? (
              <details style={{ marginTop: 8 }}>
                <summary className="dx-textbtn" style={{ display: "inline", cursor: "pointer" }}>
                  {blockers.length + warnings.length === 1 ? "Show the finding" : `Show the ${blockers.length + warnings.length} findings`}
                </summary>
                <ScanFindings findings={[...blockers, ...warnings]} />
              </details>
            ) : null}
          </div>
        ) : null}

        {rejecting ? (
          <form
            style={{ display: "grid", gap: 14, marginTop: 20, maxWidth: 560 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim()) onAction(sub.id, "reject", reason.trim());
            }}
          >
            <div className="bw-form-field">
              <label htmlFor={reasonId} className="bw-label">
                Reason for rejecting {sub.extensionName}
              </label>
              <textarea
                id={reasonId}
                className="bw-input"
                rows={3}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby={`${reasonId}-help`}
              />
              <p className="bw-help" id={`${reasonId}-help`}>
                The author reads this. Say what to change so the next submission passes.
              </p>
            </div>
            <div className="bw-btns">
              <button type="submit" className="bw-btn" disabled={actionInProgress || !reason.trim()}>
                {actionInProgress ? "Rejecting…" : "Reject the submission"}
              </button>
              <button type="button" className="bw-btn bw-btn-ghost" onClick={() => setRejecting(false)} disabled={actionInProgress}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>

      {rejecting ? null : (
        <div className="dx-rows-actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <button type="button" onClick={() => onAction(sub.id, "approve")} disabled={actionInProgress} className="bw-btn bw-btn-sm">
            <Check size={16} {...ICON} />
            {actionInProgress ? "Approving…" : "Approve"}
          </button>
          <button type="button" onClick={() => setRejecting(true)} disabled={actionInProgress} className="bw-btn bw-btn-ghost bw-btn-sm">
            <X size={16} {...ICON} />
            Reject
          </button>
        </div>
      )}
    </li>
  );
}
