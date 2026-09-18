"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  FileCode,
  FolderTree,
  GitBranch,
  Github,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";

interface AuthorSession {
  id: string;
  githubLogin: string;
  displayName: string;
}

interface ScanFinding {
  severity: "block" | "warn" | "info";
  rule: string;
  message: string;
  file?: string;
  line?: number;
  snippet?: string;
}

interface SubmitResult {
  ok: boolean;
  message: string;
  warnings?: ScanFinding[];
  blockers?: ScanFinding[];
  scanSummary?: { fileCount: number; jsFiles: number; cssFiles: number };
}

export default function SubmitPage() {
  const [author, setAuthor] = useState<AuthorSession | null>(null);
  const [loading, setLoading] = useState(true);

  const [repoUrl, setRepoUrl] = useState("");
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

  function login() {
    window.location.href = "/api/v1/auth/github";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
            ? `Submission received: ${slug}@${version}. An admin will review it shortly.`
            : "Submission received. An admin will review it shortly — you'll be notified via GitHub.",
          warnings,
          scanSummary: scan
            ? {
                fileCount: scan.fileCount,
                jsFiles: scan.jsFiles,
                cssFiles: scan.cssFiles,
              }
            : undefined,
        });
        setRepoUrl("");
        setRef("");
        setSubpath("");
      } else {
        setResult({
          ok: false,
          message: data.error || "Submission failed",
          blockers: (data.findings as ScanFinding[]) || undefined,
          scanSummary: data.summary
            ? {
                fileCount: data.summary.fileCount,
                jsFiles: data.summary.jsFiles,
                cssFiles: data.summary.cssFiles,
              }
            : undefined,
        });
      }
    } catch {
      setResult({ ok: false, message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Upload className="w-3 h-3" />
            Submit
          </>
        }
        title="Ship an"
        titleAccent="extension."
        description="Share your plugin or theme with the Bulwark community. Every extension must be free, open source, and hosted on GitHub."
      />

      <div className="mx-auto max-w-3xl px-5 sm:px-8 lg:px-14 py-12 sm:py-16">
        {/* Requirements card */}
        <div className="rounded-md border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h2 className="text-[14px] font-semibold text-foreground">
              Requirements
            </h2>
          </div>
          <ul className="space-y-1.5 text-[13px] text-muted-foreground">
            <li className="flex gap-2">
              <span className="text-primary mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" />
              Public GitHub repository with an OSI-approved license
            </li>
            <li className="flex gap-2">
              <span className="text-primary mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" />
              Valid <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded-sm">manifest.json</code> in the repo root
            </li>
            <li className="flex gap-2">
              <span className="text-primary mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" />
              No minified or obfuscated code
            </li>
            <li className="flex gap-2">
              <span className="text-primary mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" />
              No paid or closed-source extensions
            </li>
            <li className="flex gap-2">
              <span className="text-primary mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" />
              Must not collect data beyond what permissions allow
            </li>
          </ul>
          <p className="mt-4 pt-3 border-t border-border/60 text-[12px] text-muted-foreground">
            Read the full{" "}
            <Link href="https://bulwarkmail.org/docs/extensions/guidelines" className="text-primary font-medium hover:underline">
              submission guidelines
            </Link>{" "}
            before submitting.
          </p>
        </div>

        {/* Auth / Form */}
        {loading ? (
          <div className="mt-8 py-12 text-center text-muted-foreground text-[13px]">
            Loading...
          </div>
        ) : !author ? (
          <div className="mt-8 rounded-md border border-border bg-card p-8 text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary mb-4">
              <Github className="w-6 h-6" />
            </div>
            <h2 className="text-[15px] font-semibold text-foreground">
              Sign in with GitHub
            </h2>
            <p className="mt-2 text-[13px] text-muted-foreground max-w-sm mx-auto">
              We use your GitHub identity to verify repository ownership and notify you about
              review decisions.
            </p>
            <button
              onClick={login}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-foreground text-background font-medium text-sm hover:bg-foreground/90 transition-colors"
            >
              <Github className="w-4 h-4" />
              Continue with GitHub
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium text-foreground">{author.displayName}</span>
              <span className="text-muted-foreground/60">·</span>
              <span className="font-mono text-[12px]">@{author.githubLogin}</span>
            </div>

            <div>
              <label
                htmlFor="repoUrl"
                className="block text-[13px] font-medium text-foreground mb-1.5"
              >
                GitHub repository URL
              </label>
              <div className="relative">
                <Github className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  id="repoUrl"
                  type="url"
                  required
                  pattern="https://github\.com/.+/.+"
                  placeholder="https://github.com/user/my-extension"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full rounded-md border border-input bg-card pl-10 pr-3 py-2.5 text-[14px] text-foreground shadow-sm transition-all placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10"
                />
              </div>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                Public GitHub repo. You can also paste a tree URL like{" "}
                <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded-sm">
                  github.com/owner/repo/tree/main/plugin-name
                </code>{" "}
                to point at a subdirectory in a monorepo.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="ref"
                  className="block text-[13px] font-medium text-foreground mb-1.5"
                >
                  Git ref{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </label>
                <div className="relative">
                  <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    id="ref"
                    type="text"
                    placeholder="v1.0.0 or main"
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    className="w-full rounded-md border border-input bg-card pl-10 pr-3 py-2.5 text-[14px] text-foreground shadow-sm transition-all placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10"
                  />
                </div>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  Tag, branch, or commit SHA. Defaults to the repo&apos;s default branch.
                </p>
              </div>

              <div>
                <label
                  htmlFor="subpath"
                  className="block text-[13px] font-medium text-foreground mb-1.5"
                >
                  Subpath{" "}
                  <span className="text-muted-foreground font-normal">
                    (monorepos)
                  </span>
                </label>
                <div className="relative">
                  <FolderTree className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    id="subpath"
                    type="text"
                    placeholder="jitsi-meet"
                    value={subpath}
                    onChange={(e) => setSubpath(e.target.value)}
                    className="w-full rounded-md border border-input bg-card pl-10 pr-3 py-2.5 text-[14px] text-foreground shadow-sm transition-all placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10"
                  />
                </div>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  Directory inside the repo where{" "}
                  <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded-sm">
                    manifest.json
                  </code>{" "}
                  lives. Leave blank if it&apos;s at the repo root.
                </p>
              </div>
            </div>
            {result && (
              <div className="space-y-3">
                <div
                  className={`rounded-md border p-3 text-[13px] flex items-start gap-2 ${
                    result.ok
                      ? "bg-success/10 border-success/30 text-success"
                      : "bg-destructive/10 border-destructive/30 text-destructive"
                  }`}
                >
                  {result.ok ? (
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  )}
                  <span>{result.message}</span>
                </div>

                {result.scanSummary && (
                  <div className="text-[12px] text-muted-foreground flex items-center gap-3">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Scanned <strong className="text-foreground">{result.scanSummary.fileCount}</strong> files
                    <span className="text-muted-foreground/60">·</span>
                    <span>{result.scanSummary.jsFiles} JS</span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{result.scanSummary.cssFiles} CSS</span>
                  </div>
                )}

                {result.blockers && result.blockers.length > 0 && (
                  <FindingsList
                    title={`${result.blockers.length} blocking issue${result.blockers.length === 1 ? "" : "s"}`}
                    tone="block"
                    findings={result.blockers}
                  />
                )}

                {result.warnings && result.warnings.length > 0 && (
                  <FindingsList
                    title={`${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"} for the reviewer`}
                    tone="warn"
                    findings={result.warnings}
                  />
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground font-medium text-sm shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="w-4 h-4" />
              {submitting ? "Submitting..." : "Submit for review"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function FindingsList({
  title,
  tone,
  findings,
}: {
  title: string;
  tone: "block" | "warn";
  findings: ScanFinding[];
}) {
  const isBlock = tone === "block";
  return (
    <div
      className={`rounded-md border ${
        isBlock
          ? "bg-destructive/5 border-destructive/30"
          : "bg-warning/5 border-warning/30"
      }`}
    >
      <div
        className={`px-3 py-2 border-b ${
          isBlock ? "border-destructive/20" : "border-warning/20"
        } flex items-center gap-2 text-[13px] font-semibold ${
          isBlock ? "text-destructive" : "text-warning"
        }`}
      >
        {isBlock ? (
          <AlertCircle className="w-4 h-4" />
        ) : (
          <ShieldCheck className="w-4 h-4" />
        )}
        {title}
      </div>
      <ul className="divide-y divide-border/40">
        {findings.map((f, i) => (
          <li key={`${f.rule}-${i}`} className="px-3 py-2 text-[12px]">
            <div className="flex items-start gap-2">
              <code className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm bg-muted text-foreground shrink-0">
                {f.rule}
              </code>
              <div className="min-w-0 flex-1">
                <p className="text-foreground">{f.message}</p>
                {(f.file || f.line) && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
                    {f.file}
                    {f.line ? `:${f.line}` : ""}
                  </p>
                )}
                {f.snippet && (
                  <pre className="mt-1 px-2 py-1 rounded-sm bg-muted/60 text-[11px] font-mono text-muted-foreground overflow-x-auto">
                    {f.snippet}
                  </pre>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
