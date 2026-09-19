"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, Settings } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { ICON } from "@/components/icon";

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

  useEffect(() => {
    if (open) {
      setRepo(defaultRepo);
      setSubpath(defaultSubpath);
      setDescription(defaultDescription);
      setError(null);
      setSaved(false);
    }
  }, [open, defaultRepo, defaultSubpath, defaultDescription]);

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
    if (description.trim() !== defaultDescription) payload.description = description.trim();

    if (Object.keys(payload).length === 0) {
      setError("Nothing has changed. Change a field, then save.");
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
        setError(data.error ?? `The change was not saved (HTTP ${res.status}).`);
      }
    } catch {
      setError("The directory could not be reached. Check your connection and save again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClassName ?? "bw-btn bw-btn-ghost bw-btn-sm"}
      >
        {buttonClassName ? null : <Settings size={16} {...ICON} />}
        {buttonLabel ?? "Edit settings"}
        {buttonLabel ? <span className="sr-only"> {extensionName}</span> : null}
      </button>

      {open ? (
        <Dialog
          id={`edit-${slug}`}
          title={asAdmin ? `Edit ${extensionName} as an admin` : `Edit ${extensionName}`}
          description="Changes take effect at once. Later submissions use the new repository and folder as their default."
          onClose={close}
        >
          <form onSubmit={handleSubmit} className="dx-dialog-body" aria-busy={submitting}>
            <div className="bw-form-field">
              <label htmlFor={`edit-${slug}-repo`} className="bw-label">
                GitHub repository
              </label>
              <input
                id={`edit-${slug}-repo`}
                type="text"
                required
                className="bw-input"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo or https://github.com/owner/repo"
                aria-describedby={`edit-${slug}-repo-help`}
                disabled={submitting}
              />
              <p className="bw-help" id={`edit-${slug}-repo-help`}>
                Must be public. The directory checks the repository on GitHub before saving.
              </p>
            </div>

            <div className="bw-form-field">
              <label htmlFor={`edit-${slug}-subpath`} className="bw-label">
                Folder <span className="bw-label-opt">(optional)</span>
              </label>
              <input
                id={`edit-${slug}-subpath`}
                type="text"
                className="bw-input"
                value={subpath}
                onChange={(e) => setSubpath(e.target.value)}
                placeholder="my-plugin"
                aria-describedby={`edit-${slug}-subpath-help`}
                disabled={submitting}
              />
              <p className="bw-help" id={`edit-${slug}-subpath-help`}>
                Where manifest.json lives in a monorepo. Empty means the root.
              </p>
            </div>

            <div className="bw-form-field">
              <label htmlFor={`edit-${slug}-desc`} className="bw-label">
                Short description
              </label>
              <textarea
                id={`edit-${slug}-desc`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={500}
                className="bw-input"
                aria-describedby={`edit-${slug}-desc-help`}
                disabled={submitting}
              />
              <p className="bw-help" id={`edit-${slug}-desc-help`}>
                {description.length} of 500 characters.
              </p>
            </div>

            {error ? (
              <div className="bw-note dx-note-bad" role="alert">
                <span className="dx-note-lead">
                  <CircleX size={16} {...ICON} />
                  Not saved.
                </span>{" "}
                {error}
              </div>
            ) : null}

            {saved ? (
              <div className="bw-note dx-note-ok" role="status">
                <span className="dx-note-lead">
                  <CircleCheck size={16} {...ICON} />
                  Saved.
                </span>
              </div>
            ) : null}

            <div className="bw-btns dx-dialog-foot">
              <button type="button" onClick={close} disabled={submitting} className="bw-btn bw-btn-ghost">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="bw-btn">
                {submitting ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
