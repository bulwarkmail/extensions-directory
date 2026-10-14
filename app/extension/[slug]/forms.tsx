"use client";

import { useState } from "react";
import { ActionForm } from "@/components/client/action";
import { api } from "@/components/client/api";

export function RateForm({ slug }: { slug: string }) {
  return (
    <details className="dx-details">
      <summary>Rate this extension</summary>
      <ActionForm path={`/extensions/${slug}/rating`} submit="Save rating" fields={[
        { name: "stars", label: "Stars", type: "select", options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: "★".repeat(n) })) },
        { name: "body", label: "What worked, what didn't", type: "textarea", optional: true, rows: 4 },
      ]} />
    </details>
  );
}

/** Open to anyone, signed in or not; webmail admins can report from here. */
export function ReportForm({ slug, versions }: { slug: string; versions: string[] }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (sent) return <p className="bw-note">Thanks. Staff look at every report; reports of malware right away.</p>;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/extensions/${slug}/reports`, {
        reason: f.get("reason"), details: f.get("details"), version: f.get("version") || undefined,
        contactEmail: f.get("contactEmail") || undefined, website: f.get("website") || undefined,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="dx-details">
      <summary>Report this extension to the directory staff</summary>
      <form className="bw-form" onSubmit={onSubmit}>
        <div className="bw-form-field">
          <label className="bw-label" htmlFor="rep-reason">What is wrong</label>
          <select id="rep-reason" name="reason" className="bw-input">
            <option value="malware">It does something harmful</option>
            <option value="privacy">It sends data where it shouldn&apos;t</option>
            <option value="impersonation">It pretends to be someone else</option>
            <option value="broken">It is broken</option>
            <option value="spam">Spam</option>
            <option value="other">Something else</option>
          </select>
        </div>
        <div className="bw-form-field">
          <label className="bw-label" htmlFor="rep-version">Version <span className="bw-label-opt">(optional)</span></label>
          <select id="rep-version" name="version" className="bw-input" defaultValue="">
            <option value="">Not sure</option>
            {versions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="bw-form-field bw-form-full">
          <label className="bw-label" htmlFor="rep-details">Details</label>
          <textarea id="rep-details" name="details" className="bw-input" rows={5} required minLength={10} maxLength={5000} />
        </div>
        <div className="bw-form-field">
          <label className="bw-label" htmlFor="rep-email">Your email <span className="bw-label-opt">(optional, for questions)</span></label>
          <input id="rep-email" name="contactEmail" type="email" className="bw-input" />
        </div>
        {/* Left empty by people; bots fill it in. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}>
          <label htmlFor="rep-website">Website</label>
          <input id="rep-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <div className="bw-form-full">
          <button type="submit" className="bw-btn" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
          {error ? <p className="bw-help bw-help-error" role="alert">{error}</p> : null}
        </div>
      </form>
    </details>
  );
}
