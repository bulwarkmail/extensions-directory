"use client";

import { useState } from "react";
import { api } from "@/components/client/api";
import { showHidden } from "@/lib/hidden-characters";

/**
 * One answer of GET /api/v2/admin/submissions/:id/file: a part of the file and
 * of its previous version. In the page's state, the parts loaded so far, joined.
 */
interface FileData {
  path: string;
  size: number;
  offset: number;
  text: string | null;
  textLength: number | null;
  previous: string | null;
  previousLength: number | null;
  previousVersion: string | null;
  nextOffset: number | null;
}

const tooManyLines = (a: number, b: number) => a * b > 4_000_000;
const lineCount = (s: string) => s.split("\n").length;

/** A line diff good enough for review: longest common subsequence, capped. */
function lineDiff(a: string, b: string): { op: " " | "+" | "-"; line: string }[] {
  const x = a.split("\n");
  const y = b.split("\n");
  if (tooManyLines(x.length, y.length)) return [...x.map((line) => ({ op: "-" as const, line })), ...y.map((line) => ({ op: "+" as const, line }))];
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { op: " " | "+" | "-"; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { out.push({ op: " ", line: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "-", line: x[i++] });
    else out.push({ op: "+", line: y[j++] });
  }
  while (i < x.length) out.push({ op: "-", line: x[i++] });
  while (j < y.length) out.push({ op: "+", line: y[j++] });
  return out;
}

const count = (x: number) => x.toLocaleString("en");

export function FileBrowser({ submissionId, files }: { submissionId: string; files: { name: string; size: number; changed: boolean }[] }) {
  const [open, setOpen] = useState<FileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyChanges, setOnlyChanges] = useState(true);

  const url = (name: string, offset: number) => `/admin/submissions/${submissionId}/file?path=${encodeURIComponent(name)}${offset ? `&offset=${offset}` : ""}`;

  async function show(name: string) {
    setError(null);
    try {
      setOpen(await api<FileData>("GET", url(name, 0)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadNext() {
    if (!open || open.nextOffset === null) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api<FileData>("GET", url(open.path, open.nextOffset));
      setOpen({
        ...open,
        text: open.text === null ? null : open.text + (next.text ?? ""),
        previous: open.previous === null ? null : open.previous + (next.previous ?? ""),
        nextOffset: next.nextOffset,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const diff = open?.text !== null && open?.previous !== null && open ? lineDiff(open.previous ?? "", open.text ?? "") : null;
  const total = open ? Math.max(open.textLength ?? 0, open.previousLength ?? 0) : 0;
  const loaded = open ? Math.max(open.text?.length ?? 0, open.previous?.length ?? 0) : 0;
  const partial = !!open && open.nextOffset !== null;
  // A minified bundle is one long line: the line diff can only show it removed and added whole.
  const oneLine = !!diff && !!open && lineCount(open.text ?? "") === 1 && lineCount(open.previous ?? "") === 1 && loaded > 1000;
  const wholeFile = !!diff && !!open && tooManyLines(lineCount(open.previous ?? ""), lineCount(open.text ?? ""));
  return (
    <div className="dx-files">
      <ul className="dx-filelist">
        {files.map((f) => (
          <li key={f.name}>
            <button type="button" className="dx-textbtn" onClick={() => show(f.name)} aria-current={open?.path === f.name ? "true" : undefined}>
              {f.changed ? <strong>{f.name}</strong> : f.name}
            </button>{" "}
            <span className="bw-muted">{f.size} B{f.changed ? ", changed" : ""}</span>
          </li>
        ))}
      </ul>
      {error ? <p className="bw-help bw-help-error">{error}</p> : null}
      {open ? (
        <div>
          <h3 className="bw-h3">{open.path}</h3>
          {partial ? (
            <div className="bw-note bw-note-warning" role="status">
              <p>
                <strong>{count(loaded)} of {count(total)} characters shown.</strong> The rest of the file is not on this page yet
                {diff ? ", and the comparison covers only the loaded part" : ""}. Load every part before you approve.
              </p>
              <button type="button" className="bw-btn bw-btn-sm" onClick={loadNext} disabled={busy}>{busy ? "Loading…" : "Load the next part"}</button>
            </div>
          ) : null}
          {oneLine ? <p className="bw-note bw-note-warning">This file is one line, so any change in it shows the whole line as removed and added.</p> : null}
          {wholeFile ? <p className="bw-note bw-note-warning">Too many lines to compare line by line: the whole file is shown as removed and added.</p> : null}
          {open.text === null ? <p>Binary file, {open.size} bytes.</p> : diff ? (
            <>
              <label className="bw-check"><input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Only changed lines (against {open.previousVersion})</label>
              <pre className="bw-code dx-log dx-diff"><code>
                {diff.filter((d, idx) => !onlyChanges || d.op !== " " || diff.slice(Math.max(0, idx - 2), idx + 3).some((x) => x.op !== " ")).map((d, idx) => (
                  <span key={idx} className={d.op === "+" ? "dx-add" : d.op === "-" ? "dx-del" : undefined}>{`${d.op} ${showHidden(d.line)}\n`}</span>
                ))}
              </code></pre>
            </>
          ) : (
            <pre className="bw-code dx-log"><code>{showHidden(open.text)}</code></pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
