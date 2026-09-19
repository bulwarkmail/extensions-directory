import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getExtensions } from "@/lib/db/queries";
import { ExtensionGrid } from "@/components/extension-grid";
import { Pager } from "@/components/pager";
import { ICON } from "@/components/icon";

const PER_PAGE = 24;

const SORT_PHRASE: Record<string, string> = {
  newest: "newest first",
  updated: "recently updated first",
  downloads: "most downloaded first",
  name: "by name",
};

/**
 * The result count, the tiles and the pager for /plugins, /themes and
 * /search. An empty result says what was searched and what to try next.
 */
export async function BrowseListing({
  path,
  params,
  type,
}: {
  path: string;
  params: Record<string, string | undefined>;
  type?: "plugin" | "theme";
}) {
  const sort = params.sort || "newest";
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  let data: Awaited<ReturnType<typeof getExtensions>>["data"] = [];
  let meta = { page, perPage: PER_PAGE, total: 0 };

  try {
    const result = await getExtensions({
      type,
      pluginType: type === "plugin" ? params.pluginType : undefined,
      tag: params.tag,
      q: params.q,
      sort,
      order: (params.order as "asc" | "desc") || (sort === "name" ? "asc" : "desc"),
      page,
      perPage: PER_PAGE,
    });
    data = result.data;
    meta = result.meta;
  } catch {
    // DB not available
  }

  const noun = type === "plugin" ? "plugin" : type === "theme" ? "theme" : "extension";
  const plural = (n: number) => (n === 1 ? noun : `${noun}s`);
  const pageCount = Math.max(1, Math.ceil(meta.total / meta.perPage));
  const filtered = Boolean(params.q || params.tag);

  const emptyTitle = params.q
    ? `No ${noun} matches “${params.q}”.`
    : params.tag
      ? `No ${noun} has the tag “${params.tag}”.`
      : `There are no ${noun}s yet.`;
  const emptyMessage = params.q
    ? type
      ? `Check the spelling, or search for a word from the name or description. Only ${noun}s are searched on this page.`
      : "Check the spelling, or search for a word from the name or description."
    : params.tag
      ? "Choose another tag, or clear the filter to see everything."
      : "Submit the first one. Every submission is reviewed before it is published.";

  return (
    <>
      {data.length > 0 ? (
        <p className="dx-count" aria-live="polite">
          {meta.total.toLocaleString()} {plural(meta.total)}
          {params.q ? ` matching “${params.q}”` : ""}
          {params.tag ? ` tagged “${params.tag}”` : ""}, {SORT_PHRASE[sort] ?? SORT_PHRASE.newest}
        </p>
      ) : null}
      <ExtensionGrid
        extensions={data}
        emptyTitle={emptyTitle}
        emptyMessage={emptyMessage}
        emptyActions={
          filtered ? (
            <>
              {type && params.q ? (
                <Link href={`/search?q=${encodeURIComponent(params.q)}`} className="bw-btn">
                  Search plugins and themes
                  <ArrowRight size={16} {...ICON} />
                </Link>
              ) : null}
              <Link href={path} className="bw-btn bw-btn-ghost">
                Clear the search and filters
              </Link>
            </>
          ) : (
            <Link href="/submit" className="bw-btn">
              Submit an extension
              <ArrowRight size={16} {...ICON} />
            </Link>
          )
        }
      />
      <Pager path={path} params={params} page={meta.page} pageCount={pageCount} />
    </>
  );
}
