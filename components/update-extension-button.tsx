"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

interface ScanFinding {
  severity: "block" | "warn" | "info";
  rule: string;
  message: string;
  file?: string;
  line?: number;
  snippet?: string;
}

interface SubmitResponse {
  data?: {
    slug: string;
    version: string;
    status: string;
  };
  error?: string;
  findings?: ScanFinding[];
}

interface Props {
  slug: string;
  extensionName: string;
  defaultRepoUrl: string;
  defaultSubpath: string;
  hasOpenSubmission: boolean;
  currentVersion: string | null;
}

export function UpdateExtensionButton({
  slug,
  extensionName,
  defaultRepoUrl,
  defaultSubpath,
  hasOpenSubmission,
  currentVersion,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<ScanFinding[]>([]);
  const [success, setSuccess] = useState<{ version: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function reset() {
    setRef("");
    setError(null);
    setBlockers([]);
    setSuccess(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setBlockers([]);

    try {
      const res = await fetch("/api/v1/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: defaultRepoUrl,
          ref: ref.trim() || undefined,
          subpath: defaultSubpath || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as SubmitResponse;

      if (res.ok && data.data) {
        setSuccess({ version: data.data.version });
        // Refresh server data so the dashboard reflects the new pending submission.
        router.refresh();
      } else {
        setError(data.error ?? `Submission failed (HTTP ${res.status})`);
        if (Array.isArray(data.findings)) {
          setBlockers(data.findings);
        }
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={hasOpenSubmission}
        title={
          hasOpenSubmission
            ? "An update for this extension is already in review"
            : "Re-scan the latest commit and submit it for review"
        }
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        I pushed an update
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={close}
            aria-hidden
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`update-${slug}-title`}
            className="relative w-full max-w-md rounded-md border border-border bg-card shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
              <div>
                <h3
                  id={`update-${slug}-title`}
                  className="text-[15px] font-semibold text-foreground"
                >
                  Submit update for {extensionName}
                </h3>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  We&apos;ll re-scan{" "}
                  <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded-sm">
                    {defaultRepoUrl.replace("https://github.com/", "")}
                    {defaultSubpath ? `/${defaultSubpath}` : ""}
                  </code>{" "}
                  at the ref you provide and queue it for admin review.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {success ? (
              <div className="px-5 py-6 space-y-4">
                <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[13px] text-success flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Submission received: v{success.version}. An admin will
                    review it shortly.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="w-full inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
                {currentVersion && (
                  <p className="text-[12px] text-muted-foreground">
                    Currently published:{" "}
                    <span className="font-mono text-foreground">
                      v{currentVersion}
                    </span>
                  </p>
                )}

                <div>
                  <label
                    htmlFor={`update-${slug}-ref`}
                    className="block text-[13px] font-medium text-foreground mb-1.5"
                  >
                    Git ref{" "}
                    <span className="text-muted-foreground font-normal">
                      (tag, branch, or commit)
                    </span>
                  </label>
                  <div className="relative">
                    <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      id={`update-${slug}-ref`}
                      type="text"
                      autoFocus
                      placeholder="v1.2.0"
                      value={ref}
                      onChange={(e) => setRef(e.target.value)}
                      className="w-full rounded-md border border-input bg-card pl-10 pr-3 py-2 text-[14px] text-foreground shadow-sm transition-all placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10"
                    />
                  </div>
                  <p className="mt-1.5 text-[12px] text-muted-foreground">
                    Leave blank to use the repo&apos;s default branch (latest
                    commit).
                  </p>
                </div>

                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {blockers.length > 0 && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5">
                    <div className="px-3 py-2 border-b border-destructive/20 flex items-center gap-2 text-[12px] font-semibold text-destructive">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {blockers.length} blocking issue
                      {blockers.length === 1 ? "" : "s"}
                    </div>
                    <ul className="divide-y divide-border/40 max-h-40 overflow-y-auto">
                      {blockers.map((f, i) => (
                        <li
                          key={`${f.rule}-${i}`}
                          className="px-3 py-2 text-[11px]"
                        >
                          <code className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm bg-muted text-foreground">
                            {f.rule}
                          </code>
                          <p className="mt-1 text-foreground">{f.message}</p>
                          {f.file && (
                            <p className="mt-0.5 text-muted-foreground font-mono truncate">
                              {f.file}
                              {f.line ? `:${f.line}` : ""}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={submitting}
                    className="px-4 py-2 rounded-md border border-border bg-card text-foreground text-[13px] font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-[13px] font-medium shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    {submitting ? "Submitting..." : "Submit for review"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
