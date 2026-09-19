import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ICON } from "@/components/icon";

/**
 * Previous and Next with the page count between them. The links keep every
 * other parameter of the current listing (search, tag, sort, type).
 */
export function Pager({
  path,
  params,
  page,
  pageCount,
}: {
  path: string;
  params: Record<string, string | undefined>;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const href = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") p.set(k, v);
    if (n > 1) p.set("page", String(n));
    const s = p.toString();
    return s ? `${path}?${s}` : path;
  };
  return (
    <nav className="dx-pager" aria-label="Pages">
      {page > 1 ? (
        <Link href={href(page - 1)} className="bw-btn bw-btn-ghost bw-btn-sm" rel="prev">
          <ArrowLeft size={16} {...ICON} />
          Previous
        </Link>
      ) : null}
      <span aria-current="page">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className="bw-btn bw-btn-ghost bw-btn-sm" rel="next">
          Next
          <ArrowRight size={16} {...ICON} />
        </Link>
      ) : null}
    </nav>
  );
}
