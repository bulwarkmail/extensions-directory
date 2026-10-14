"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";

export function NewTokenForm({ extensions }: { extensions: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ token: string }>("POST", "/tokens", {
        name: f.get("name"),
        extensions: f.getAll("extensions"),
        scopes: f.getAll("scopes"),
        days: Number(f.get("days")),
      });
      setToken(data.token);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (token) {
    return (
      <div className="bw-note">
        <p><strong>Copy this token now.</strong> It is not shown again; only a hash is stored.</p>
        <pre className="bw-code"><code>{token}</code></pre>
        <p>Use it as <code className="bw-icode">BULWARK_EXTENSIONS_TOKEN</code>:</p>
        <pre className="bw-code"><code>{`BULWARK_EXTENSIONS_TOKEN=${token.slice(0, 16)}… npx @bulwarkmail/extension-cli publish --slug <id> --ref v1.2.0`}</code></pre>
        <button type="button" className="bw-btn bw-btn-ghost" onClick={() => setToken(null)}>Done</button>
      </div>
    );
  }

  return (
    <form className="bw-form" onSubmit={onSubmit}>
      <div className="bw-form-field">
        <label className="bw-label" htmlFor="tok-name">Name</label>
        <input id="tok-name" name="name" className="bw-input" required maxLength={80} placeholder="gitlab-ci" />
      </div>
      <div className="bw-form-field">
        <label className="bw-label" htmlFor="tok-days">Expires after</label>
        <select id="tok-days" name="days" className="bw-input" defaultValue="90">
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">1 year</option>
        </select>
      </div>
      <fieldset className="bw-form-field">
        <legend className="bw-label">Extensions</legend>
        {extensions.map((e) => (
          <label key={e.slug} className="bw-check"><input type="checkbox" name="extensions" value={e.slug} /> {e.name}</label>
        ))}
      </fieldset>
      <fieldset className="bw-form-field">
        <legend className="bw-label">Can</legend>
        <label className="bw-check"><input type="checkbox" name="scopes" value="publish" defaultChecked /> Submit versions for review</label>
        <label className="bw-check"><input type="checkbox" name="scopes" value="dry_run" defaultChecked /> Run dry runs</label>
        <label className="bw-check"><input type="checkbox" name="scopes" value="read" defaultChecked /> Read submission status</label>
      </fieldset>
      <div className="bw-form-full">
        <button type="submit" className="bw-btn" disabled={busy}>{busy ? "Creating…" : "Create token"}</button>
        {error ? <p className="bw-help bw-help-error" role="alert">{error}</p> : null}
      </div>
    </form>
  );
}
