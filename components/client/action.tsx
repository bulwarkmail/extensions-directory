"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "./api";

type Method = "POST" | "PATCH" | "DELETE";

/**
 * A button that calls one v2 endpoint and refreshes the page. With `ask`,
 * it asks for a reason (or notes) first; with `confirm`, it asks to confirm.
 */
export function ActionButton({
  method = "POST",
  path,
  body,
  label,
  busyLabel,
  confirm,
  ask,
  askField = "reason",
  askRequired = true,
  ghost,
  small,
  onDone,
}: {
  method?: Method;
  path: string;
  body?: Record<string, unknown>;
  label: ReactNode;
  busyLabel?: string;
  confirm?: string;
  ask?: string;
  askField?: string;
  askRequired?: boolean;
  ghost?: boolean;
  small?: boolean;
  onDone?: (data: unknown) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    let payload = body;
    if (ask) {
      const answer = window.prompt(ask);
      if (answer === null) return;
      if (askRequired && !answer.trim()) return;
      payload = { ...body, [askField]: answer };
    } else if (confirm && !window.confirm(confirm)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api(method, path, payload ?? {});
      onDone?.(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="dx-action">
      <button type="button" className={`bw-btn${ghost ? " bw-btn-ghost" : ""}${small ? " bw-btn-sm" : ""}`} onClick={run} disabled={busy}>
        {busy ? busyLabel ?? "Working…" : label}
      </button>
      {error ? <span className="bw-help bw-help-error" role="alert">{error}</span> : null}
    </span>
  );
}

export interface Field {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select" | "checkbox" | "number" | "email";
  placeholder?: string;
  help?: ReactNode;
  optional?: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: string | boolean;
  rows?: number;
}

/** A small form that sends its fields as JSON to one v2 endpoint. */
export function ActionForm({
  method = "POST",
  path,
  fields,
  submit,
  extra,
  onDone,
  resetOnDone = true,
}: {
  method?: Method;
  path: string;
  fields: Field[];
  submit: string;
  extra?: Record<string, unknown>;
  onDone?: (data: unknown) => void;
  resetOnDone?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const body: Record<string, unknown> = { ...extra };
    for (const f of fields) {
      if (f.type === "checkbox") body[f.name] = data.get(f.name) === "on";
      else {
        const v = String(data.get(f.name) ?? "");
        if (v !== "" || !f.optional) body[f.name] = f.type === "number" ? Number(v) : v;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api(method, path, body);
      if (resetOnDone) form.reset();
      onDone?.(result);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="bw-form" onSubmit={onSubmit}>
      {fields.map((f) => (
        <div key={f.name} className={`bw-form-field${f.type === "textarea" ? " bw-form-full" : ""}`}>
          {f.type === "checkbox" ? (
            <label className="bw-check">
              <input type="checkbox" name={f.name} defaultChecked={f.defaultValue === true} />
              {f.label}
            </label>
          ) : (
            <>
              <label className="bw-label" htmlFor={`f-${path}-${f.name}`}>
                {f.label}
                {f.optional ? <span className="bw-label-opt"> (optional)</span> : null}
              </label>
              {f.type === "textarea" ? (
                <textarea id={`f-${path}-${f.name}`} name={f.name} className="bw-input" rows={f.rows ?? 6} placeholder={f.placeholder} defaultValue={f.defaultValue as string | undefined} required={!f.optional} />
              ) : f.type === "select" ? (
                <select id={`f-${path}-${f.name}`} name={f.name} className="bw-input" defaultValue={f.defaultValue as string | undefined}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input id={`f-${path}-${f.name}`} name={f.name} className="bw-input" type={f.type ?? "text"} placeholder={f.placeholder} defaultValue={f.defaultValue as string | undefined} required={!f.optional} />
              )}
            </>
          )}
          {f.help ? <p className="bw-help">{f.help}</p> : null}
        </div>
      ))}
      <div className="bw-form-full">
        <button type="submit" className="bw-btn" disabled={busy}>{busy ? "Working…" : submit}</button>
        {error ? <p className="bw-help bw-help-error" role="alert">{error}</p> : null}
      </div>
    </form>
  );
}
