"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  FolderTree,
  Github,
  Loader2,
  Settings,
  X,
} from "lucide-react";

interface Props {
  slug: string;
  extensionName: string;
  defaultRepo: string;
  defaultSubpath: string;
  defaultDescription: string;
  // Admin context: when true, the button is rendered for an admin (uses
  // /api/v1/admin/extensions instead of the author-scoped endpoint).
  asAdmin?: boolean;
  buttonClassName?: string;
  buttonLabel?: string;
  onSaved?: () => void;
}

interface UpdateResponse {
  data?: { id: string };
  error?: string;
}

export function EditExtensionButton({
  slug,
  extensionName,
  defaultRepo,
  defaultSubpath,
  defaultDescription,
  asAdmin = false,
  buttonClassName,
  buttonLabel,
  onSaved,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState(defaultRepo);
  const [subpath, setSubpath] = useState(defaultSubpath);
  const [description, setDescription] = useState(defaultDescription);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRepo(defaultRepo);
      setSubpath(defaultSubpath);
      setDescription(defaultDescription);
      setError(null);
      setSaved(false);
    }
  }, [open, defaultRepo, defaultSubpath, defaultDescription]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);

    const payload: Record<string, string> = {};
    if (repo.trim() !== defaultRepo) payload.githubRepo = repo.trim();
    if (subpath.trim() !== defaultSubpath) payload.subpath = subpath.trim();
    if (description.trim() !== defaultDescription)
      payload.description = description.trim();

    if (Object.keys(payload).length === 0) {
      setError("Nothing to save — change a field first.");
      setSubmitting(false);
      return;
    }

    try {
      const res = asAdmin
        ? await fetch("/api/v1/admin/extensions", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug, ...payload }),
          })
        : await fetch(`/api/v1/extension/${encodeURIComponent(slug)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      const data = (await res.json().catch(() => ({}))) as UpdateResponse;
      if (res.ok) {
        setSaved(true);
        router.refresh();
        onSaved?.();
        setTimeout(() => setOpen(false), 900);
      } else {
        setError(data.error ?? `Update failed (HTTP ${res.status})`);
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
        className={
          buttonClassName ??
          "inline-flex items-center gap-1.5 px-3 py-1.5 border border-[color:var(--rule)] bg-background text-foreground/80 hover:text-foreground hover:border-foreground/60 transition-colors text-[12px]"
        }
        style={{ fontFamily: "var(--font-exo2)", fontWeight: 500 }}
      >
        <Settings className="w-3.5 h-3.5" />
        {buttonLabel ?? "Edit settings"}
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
            aria-labelledby={`edit-${slug}-title`}
            className="relative w-full max-w-lg border border-[color:var(--rule)] bg-background shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-[color:var(--rule)]">
              <div>
                <div
                  className="mb-1.5"
                  style={{
                    fontFamily: "var(--font-jetbrains)",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "var(--rasp)",
                  }}
                >
                  {asAdmin ? "Admin · Edit" : "Edit"}
                </div>
                <h3
                  id={`edit-${slug}-title`}
                  className="text-foreground"
                  style={{
                    fontFamily: "var(--font-exo2)",
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    fontSize: 22,
                    lineHeight: 1.1,
                    margin: 0,
                  }}
                >
                  {extensionName}
                </h3>
                <p
                  className="mt-1 text-foreground/65"
                  style={{
                    fontFamily: "var(--font-source-serif)",
                    fontStyle: "italic",
                    fontSize: 13,
                  }}
                >
                  Changes take effect immediately. Future submissions will use
                  the new repo and subpath as their default.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="p-1 text-foreground/60 hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
              <div>
                <label
                  htmlFor={`edit-${slug}-repo`}
                  className="block mb-1.5"
                  style={{
                    fontFamily: "var(--font-exo2)",
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  GitHub repository
                </label>
                <div className="relative">
                  <Github className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/55" />
                  <input
                    id={`edit-${slug}-repo`}
                    type="text"
                    required
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="owner/repo or https://github.com/owner/repo"
                    className="w-full border border-[color:var(--rule)] bg-background pl-10 pr-3 py-2.5 text-[14px] text-foreground focus:border-foreground/60 focus:outline-none"
                    style={{ fontFamily: "var(--font-exo2)" }}
                  />
                </div>
                <p
                  className="mt-1.5 text-foreground/60"
                  style={{
                    fontFamily: "var(--font-source-serif)",
                    fontStyle: "italic",
                    fontSize: 12,
                  }}
                >
                  Must be public. The repo is verified against GitHub before
                  saving.
                </p>
              </div>

              <div>
                <label
                  htmlFor={`edit-${slug}-subpath`}
                  className="block mb-1.5"
                  style={{
                    fontFamily: "var(--font-exo2)",
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  Subpath{" "}
                  <span className="text-foreground/55 font-normal">
                    (monorepos)
                  </span>
                </label>
                <div className="relative">
                  <FolderTree className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/55" />
                  <input
                    id={`edit-${slug}-subpath`}
                    type="text"
                    value={subpath}
                    onChange={(e) => setSubpath(e.target.value)}
                    placeholder="my-plugin"
                    className="w-full border border-[color:var(--rule)] bg-background pl-10 pr-3 py-2.5 text-[14px] text-foreground focus:border-foreground/60 focus:outline-none"
                    style={{ fontFamily: "var(--font-exo2)" }}
                  />
                </div>
                <p
                  className="mt-1.5 text-foreground/60"
                  style={{
                    fontFamily: "var(--font-source-serif)",
                    fontStyle: "italic",
                    fontSize: 12,
                  }}
                >
                  Directory inside the repo where{" "}
                  <code style={{ fontFamily: "var(--font-jetbrains)", fontSize: 11 }}>
                    manifest.json
                  </code>{" "}
                  lives. Leave blank if it&apos;s at the repo root.
                </p>
              </div>

              <div>
                <label
                  htmlFor={`edit-${slug}-desc`}
                  className="block mb-1.5"
                  style={{
                    fontFamily: "var(--font-exo2)",
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  Short description
                </label>
                <textarea
                  id={`edit-${slug}-desc`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="w-full border border-[color:var(--rule)] bg-background px-3 py-2.5 text-[14px] text-foreground focus:border-foreground/60 focus:outline-none resize-none"
                  style={{ fontFamily: "var(--font-exo2)" }}
                />
                <p
                  className="mt-1 text-right text-foreground/55"
                  style={{ fontFamily: "var(--font-jetbrains)", fontSize: 11 }}
                >
                  {description.length}/500
                </p>
              </div>

              {error && (
                <div
                  className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive flex items-start gap-2"
                  style={{ fontFamily: "var(--font-exo2)", fontSize: 13 }}
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {saved && (
                <div
                  className="border border-success/40 bg-success/10 px-3 py-2 text-success flex items-start gap-2"
                  style={{ fontFamily: "var(--font-exo2)", fontSize: 13 }}
                >
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Saved.</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={submitting}
                  className="px-4 py-2 text-foreground/70 hover:text-foreground transition-colors disabled:opacity-50"
                  style={{
                    fontFamily: "var(--font-exo2)",
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 transition-colors disabled:opacity-50"
                  style={{
                    background: "var(--rasp)",
                    color: "#fff",
                    fontFamily: "var(--font-exo2)",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {submitting ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
