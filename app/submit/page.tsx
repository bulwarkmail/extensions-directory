"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, CircleCheck, CircleX, Github, TriangleAlert, Upload } from "lucide-react";
import { ICON } from "@/components/icon";
import { ScanFindings, type ScanFinding } from "@/components/scan-findings";

interface AuthorSession {
  id: string;
  githubLogin: string;
  displayName: string;
}

interface SubmitResult {
  ok: boolean;
  message: string;
  warnings?: ScanFinding[];
  blockers?: ScanFinding[];
  scanSummary?: { fileCount: number; jsFiles: number; cssFiles: number };
}

// The same rule the field's pattern attribute used before.
const REPO_PATTERN = /^https:\/\/github\.com\/.+\/.+/;

const REQUIREMENTS = [
  "A public GitHub repository with an OSI-approved licence",
  "A valid manifest.json at the root, or in the folder you name",
  "No minified or obfuscated code",
  "No paid or closed-source extensions",
  "No data collected beyond what the permissions allow",
];

export default function SubmitPage() {
  const [author, setAuthor] = useState<AuthorSession | null>(null);
  const [loading, setLoading] = useState(true);

  const [repoUrl, setRepoUrl] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [subpath, setSubpath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    fetch("/api/v1/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.author) setAuthor(data.author);
      })
      .finally(() => setLoading(false));
  }, []);

  function validateRepo(value: string): string | null {
    const v = value.trim();
    if (!v) return "Enter the address of a public GitHub repository, for example https://github.com/user/my-extension.";
    if (!REPO_PATTERN.test(v))
      return "Enter the full address, starting with https://github.com/, for example https://github.com/user/my-extension.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateRepo(repoUrl);
    setRepoError(err);
    if (err) {
      document.getElementById("repoUrl")?.focus();
      return;
    }
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/v1/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          ref: ref.trim() || undefined,
          subpath: subpath.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const slug = data?.data?.slug;
        const version = data?.data?.version;
        const scan = data?.data?.scan;
        const warnings = (scan?.warnings as ScanFinding[]) || [];
        setResult({
          ok: true,
          message: slug
            ? `${slug} ${version} is waiting for review. You hear about the decision on GitHub.`
            : "It is waiting for review. You hear about the decision on GitHub.",
          warnings,
          scanSummary: scan
            ? { fileCount: scan.fileCount, jsFiles: scan.jsFiles, cssFiles: scan.cssFiles }
            : undefined,
        });
        setRepoUrl("");
        setRef("");
        setSubpath("");
      } else {
        setResult({
          ok: false,
          message: data.error || "The submission failed.",
          blockers: (data.findings as ScanFinding[]) || undefined,
          scanSummary: data.summary
            ? { fileCount: data.summary.fileCount, jsFiles: data.summary.jsFiles, cssFiles: data.summary.cssFiles }
            : undefined,
        });
      }
    } catch {
      setResult({ ok: false, message: "The directory could not be reached. Check your connection and submit again." });
    } finally {
      setSubmitting(false);
    }
  }

  const scanLine = (s?: SubmitResult["scanSummary"]) =>
    s ? ` The scan read ${s.fileCount} files: ${s.jsFiles} JavaScript, ${s.cssFiles} CSS.` : "";

  return (
    <div className="bw-w dx-work">
      <div className="dx-work-head">
        <div>
          <h1 className="bw-h2">Submit a plugin or theme.</h1>
          <p>
            The directory fetches your repository at the ref you choose, scans the code and queues it for a reviewer.
            Every extension must be free, open source and hosted on GitHub.
          </p>
        </div>
      </div>

      <div className="dx-split">
        <div>
          {loading ? (
            <p className="bw-help" aria-live="polite">
              Checking whether you are signed in…
            </p>
          ) : !author ? (
            <div className="bw-note">
              <p>
                <b>Sign in with GitHub to submit.</b> The directory uses your GitHub identity to check that you own the
                repository and to tell you about review decisions.
              </p>
              <div className="bw-btns" style={{ marginTop: 14 }}>
                <a href="/api/v1/auth/github" className="bw-btn">
                  <Github size={16} {...ICON} />
                  Sign in with GitHub
                </a>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bw-form" noValidate aria-busy={submitting}>
              <p className="bw-form-full bw-help">
                Signed in as <span style={{ color: "var(--bw-text)", fontWeight: 500 }}>{author.displayName}</span> (@
                {author.githubLogin}).
              </p>

              <div className="bw-form-field bw-form-full">
                <label htmlFor="repoUrl" className="bw-label">
                  GitHub repository
                </label>
                <input
                  id="repoUrl"
                  type="url"
                  required
                  className="bw-input"
                  placeholder="https://github.com/user/my-extension"
                  value={repoUrl}
                  onChange={(e) => {
                    setRepoUrl(e.target.value);
                    if (repoError) setRepoError(validateRepo(e.target.value));
                  }}
                  aria-invalid={repoError ? true : undefined}
                  aria-describedby={repoError ? "repoUrl-error repoUrl-help" : "repoUrl-help"}
                  disabled={submitting}
                />
                {repoError ? (
                  <p className="bw-help bw-help-error" id="repoUrl-error">
                    <TriangleAlert size={16} {...ICON} />
                    {repoError}
                  </p>
                ) : null}
                <p className="bw-help" id="repoUrl-help">
                  A public repository. A folder address such as github.com/owner/repo/tree/main/plugin-name points at one
                  extension in a monorepo.
                </p>
              </div>

              <div className="bw-form-field">
                <label htmlFor="ref" className="bw-label">
                  Git ref <span className="bw-label-opt">(optional)</span>
                </label>
                <input
                  id="ref"
                  type="text"
                  className="bw-input"
                  placeholder="v1.0.0 or main"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  aria-describedby="ref-help"
                  disabled={submitting}
                />
                <p className="bw-help" id="ref-help">
                  A tag, branch or commit. Empty means the default branch.
                </p>
              </div>

              <div className="bw-form-field">
                <label htmlFor="subpath" className="bw-label">
                  Folder <span className="bw-label-opt">(optional)</span>
                </label>
                <input
                  id="subpath"
                  type="text"
                  className="bw-input"
                  placeholder="jitsi-meet"
                  value={subpath}
                  onChange={(e) => setSubpath(e.target.value)}
                  aria-describedby="subpath-help"
                  disabled={submitting}
                />
                <p className="bw-help" id="subpath-help">
                  Where manifest.json lives in a monorepo. Empty means the root.
                </p>
              </div>

              {result ? (
                <div className="bw-form-full" style={{ display: "grid", gap: 16 }}>
                  <div className={`bw-note ${result.ok ? "dx-note-ok" : "dx-note-bad"}`} role={result.ok ? "status" : "alert"}>
                    <span className="dx-note-lead">
                      {result.ok ? <CircleCheck size={16} {...ICON} /> : <CircleX size={16} {...ICON} />}
                      {result.ok ? "Submitted." : "Not submitted."}
                    </span>{" "}
                    {result.message}
                    {scanLine(result.scanSummary)}
                    {result.blockers && result.blockers.length > 0 ? (
                      <>
                        {" "}
                        Fix {result.blockers.length === 1 ? "this blocking issue" : `these ${result.blockers.length} blocking issues`} in
                        the repository and submit again.
                        <ScanFindings findings={result.blockers} />
                      </>
                    ) : null}
                  </div>
                  {result.warnings && result.warnings.length > 0 ? (
                    <div className="bw-note bw-note-warning dx-note-warn">
                      <span className="dx-note-lead">
                        <TriangleAlert size={16} {...ICON} />
                        {result.warnings.length === 1 ? "One note for the reviewer." : `${result.warnings.length} notes for the reviewer.`}
                      </span>{" "}
                      These do not block the submission.
                      <ScanFindings findings={result.warnings} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="bw-form-full">
                <button type="submit" className="bw-btn" disabled={submitting}>
                  {submitting ? "Fetching and scanning the repository…" : "Submit for review"}
                  {submitting ? null : <Upload size={16} {...ICON} />}
                </button>
              </div>
            </form>
          )}
        </div>

        <aside>
          <h2 className="dx-h2">Requirements</h2>
          <ul className="dx-rules">
            {REQUIREMENTS.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p style={{ marginTop: 16 }}>
            <a
              href="https://bulwarkmail.org/docs/extensions/guidelines"
              target="_blank"
              rel="noopener noreferrer"
              className="bw-tlink"
            >
              Read the submission guidelines
              <ArrowUpRight size={16} {...ICON} />
            </a>
          </p>
        </aside>
      </div>
    </div>
  );
}
