"use client";

import { useState } from "react";
import { api } from "@/components/client/api";

interface FileData {
  path: string;
  size: number;
  text: string | null;
  previous: string | null;
  previousVersion: string | null;
}

/** A line diff good enough for review: longest common subsequence, capped. */
function lineDiff(a: string, b: string): { op: " " | "+" | "-"; line: string }[] {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length * y.length > 4_000_000) return [...x.map((line) => ({ op: "-" as const, line })), ...y.map((line) => ({ op: "+" as const, line }))];
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

export function FileBrowser({ submissionId, files }: { submissionId: string; files: { name: string; size: number; changed: boolean }[] }) {
  const [open, setOpen] = useState<FileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(true);

  async function show(name: string) {
    setError(null);
    try {
      setOpen(await api<FileData>("GET", `/admin/submissions/${submissionId}/file?path=${encodeURIComponent(name)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const diff = open?.text !== null && open?.previous !== null && open ? lineDiff(open.previous ?? "", open.text ?? "") : null;
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
          {open.text === null ? <p>Binary file, {open.size} bytes.</p> : diff ? (
            <>
              <label className="bw-check"><input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Only changed lines (against {open.previousVersion})</label>
              <pre className="bw-code dx-log dx-diff"><code>
                {diff.filter((d, idx) => !onlyChanges || d.op !== " " || diff.slice(Math.max(0, idx - 2), idx + 3).some((n) => n.op !== " ")).map((d, idx) => (
                  <span key={idx} className={d.op === "+" ? "dx-add" : d.op === "-" ? "dx-del" : undefined}>{`${d.op} ${d.line}\n`}</span>
                ))}
              </code></pre>
            </>
          ) : (
            <pre className="bw-code dx-log"><code>{open.text}</code></pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
