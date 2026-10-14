// Semantic versions as extension versions use them: MAJOR.MINOR.PATCH with an
// optional pre-release (1.3.0-beta.1) and build part (ignored for ordering).
// Plus the small range syntax advisories use: comparators joined by spaces
// (AND) and "||" (OR), e.g. ">=1.0.0 <1.2.3 || 2.0.0".

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: (string | number)[];
}

const RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parse(v: string): SemVer | null {
  const m = RE.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

export function isValid(v: string): boolean {
  return parse(v) !== null;
}

export function isPrerelease(v: string): boolean {
  return (parse(v)?.pre.length ?? 0) > 0;
}

/** Semver precedence; unparseable versions sort before everything. */
export function compare(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return x ? 1 : y ? -1 : a < b ? -1 : a > b ? 1 : 0;
  for (const k of ["major", "minor", "patch"] as const) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p < q ? -1 : 1;
    if (typeof p === "number") return -1;
    if (typeof q === "number") return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export function max(versions: string[]): string | null {
  return versions.reduce<string | null>((best, v) => (best === null || compare(v, best) > 0 ? v : best), null);
}

const COMPARATOR = /^(<=|>=|<|>|=)?\s*(\S+)$/;

/** Whether `range` is something satisfies() understands. */
export function isValidRange(range: string): boolean {
  if (!range.trim()) return false;
  return range.split("||").every((alt) => {
    const parts = alt.trim().split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.every((c) => c === "*" || (COMPARATOR.test(c) && isValid(COMPARATOR.exec(c)![2])));
  });
}

export function satisfies(version: string, range: string): boolean {
  if (!isValid(version) || !isValidRange(range)) return false;
  return range.split("||").some((alt) =>
    alt.trim().split(/\s+/).filter(Boolean).every((c) => {
      if (c === "*") return true;
      const [, op = "=", v] = COMPARATOR.exec(c)!;
      const d = compare(version, v);
      return op === "<" ? d < 0 : op === "<=" ? d <= 0 : op === ">" ? d > 0 : op === ">=" ? d >= 0 : d === 0;
    })
  );
}

/** min <= app <= max, where either bound may be missing. Unknown app versions pass. */
export function appVersionFits(app: string | null | undefined, min: string | null | undefined, maxV: string | null | undefined): boolean {
  if (!app || !isValid(app)) return true;
  if (min && isValid(min) && compare(app, min) < 0) return false;
  if (maxV && isValid(maxV) && compare(app, maxV) > 0) return false;
  return true;
}
