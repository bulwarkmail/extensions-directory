export interface ScanFinding {
  severity: "block" | "warn" | "info";
  rule: string;
  message: string;
  file?: string;
  line?: number;
  snippet?: string;
}

/** Scanner findings as a table: the rule, where it matched, and what to change. */
export function ScanFindings({ findings }: { findings: ScanFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <div className="bw-table-wrap dx-findings">
      <table className="bw-table">
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Where</th>
            <th scope="col">What to change</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => (
            <tr key={`${f.rule}-${i}`}>
              <td>
                <code className="bw-icode">{f.rule}</code>
              </td>
              <td style={{ overflowWrap: "anywhere" }}>
                {f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "Whole bundle"}
              </td>
              <td>
                {f.message}
                {f.snippet ? <pre className="bw-code">{f.snippet}</pre> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
