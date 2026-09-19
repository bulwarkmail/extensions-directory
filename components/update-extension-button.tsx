"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, RefreshCw } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { ScanFindings, type ScanFinding } from "@/components/scan-findings";
import { ICON } from "@/components/icon";

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
        setError(data.error ?? `The submission failed (HTTP ${res.status}).`);
        if (Array.isArray(data.findings)) {
          setBlockers(data.findings);
        }
      }
    } catch {
      setError("The directory could not be reached. Check your connection and submit again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Display only; the request above sends defaultRepoUrl unchanged.
  const where = `${defaultRepoUrl.replace(/^(https?:\/\/github\.com\/)+/, "")}${defaultSubpath ? `/${defaultSubpath}` : ""}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={hasOpenSubmission}
        title={
          hasOpenSubmission
            ? "An update for this extension is already in review"
            : "Scan the repository again and submit it for review"
        }
        className="bw-btn bw-btn-sm"
      >
        <RefreshCw size={16} {...ICON} />
        Submit an update
      </button>

      {open ? (
        <Dialog
          id={`update-${slug}`}
          title={`Submit an update for ${extensionName}`}
          description={
            <>
              The directory scans {where} at the ref you enter and queues it for review.
              {currentVersion ? ` Published now: ${currentVersion}.` : ""}
            </>
          }
          onClose={close}
        >
          {success ? (
            <div className="dx-dialog-body">
              <div className="bw-note dx-note-ok" role="status">
                <span className="dx-note-lead">
                  <CircleCheck size={16} {...ICON} />
                  Submitted.
                </span>{" "}
                Version {success.version} is waiting for review.
              </div>
              <div className="bw-btns dx-dialog-foot">
                <button type="button" onClick={close} className="bw-btn">
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="dx-dialog-body" aria-busy={submitting}>
              <div className="bw-form-field">
                <label htmlFor={`update-${slug}-ref`} className="bw-label">
                  Git ref <span className="bw-label-opt">(optional)</span>
                </label>
                <input
                  id={`update-${slug}-ref`}
                  type="text"
                  autoFocus
                  className="bw-input"
                  placeholder="v1.2.0"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  aria-describedby={`update-${slug}-help`}
                  disabled={submitting}
                />
                <p className="bw-help" id={`update-${slug}-help`}>
                  A tag, branch or commit. Empty means the latest commit on the default branch.
                </p>
              </div>

              {error ? (
                <div className="bw-note dx-note-bad" role="alert">
                  <span className="dx-note-lead">
                    <CircleX size={16} {...ICON} />
                    Not submitted.
                  </span>{" "}
                  {error}
                  {blockers.length > 0 ? (
                    <>
                      {" "}
                      Fix {blockers.length === 1 ? "this blocking issue" : `these ${blockers.length} blocking issues`} and
                      submit again.
                      <ScanFindings findings={blockers} />
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="bw-btns dx-dialog-foot">
                <button type="button" onClick={close} disabled={submitting} className="bw-btn bw-btn-ghost">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="bw-btn">
                  {submitting ? "Scanning the repository…" : "Submit for review"}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
