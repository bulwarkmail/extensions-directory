import { Suspense } from "react";
import { ArrowLeft, ArrowRight, Puzzle } from "lucide-react";
import { SearchBar, SearchFilters } from "@/components/search-bar";
import { ExtensionGrid } from "@/components/extension-grid";
import { PageHeader } from "@/components/page-header";
import { getExtensions } from "@/lib/db/queries";

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

export const metadata = {
  title: "Plugins",
  description: "Browse plugins for Bulwark Webmail",
};

async function PluginList({ searchParams }: Props) {
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof getExtensions>>["data"] = [];
  let meta = { page: 1, perPage: 24, total: 0 };

  try {
    const result = await getExtensions({
      type: "plugin",
      pluginType: params.pluginType,
      tag: params.tag,
      q: params.q,
      sort: params.sort || "newest",
      order: (params.order as "asc" | "desc") || "desc",
      page: parseInt(params.page || "1", 10),
      perPage: 24,
    });
    data = result.data;
    meta = result.meta;
  } catch {
    // DB not available
  }

  const pageCount = Math.max(1, Math.ceil(meta.total / meta.perPage));

  return (
    <>
      <ExtensionGrid
        extensions={data}
        emptyTitle="No plugins yet"
        emptyMessage="Try a different search or filter — or submit the first one."
      />
      {meta.total > meta.perPage && (
        <Pagination
          page={meta.page}
          pageCount={pageCount}
          sort={params.sort || "newest"}
        />
      )}
    </>
  );
}

function Pagination({
  page,
  pageCount,
  sort,
}: {
  page: number;
  pageCount: number;
  sort: string;
}) {
  return (
    <div className="mt-10 flex items-center justify-center gap-2 text-[13px]">
      {page > 1 && (
        <a
          href={`?page=${page - 1}&sort=${sort}`}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 transition-colors hover:bg-muted hover:border-primary/30"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Previous
        </a>
      )}
      <span className="px-3 py-1.5 text-muted-foreground tabular-nums">
        Page {page} of {pageCount}
      </span>
      {page < pageCount && (
        <a
          href={`?page=${page + 1}&sort=${sort}`}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 transition-colors hover:bg-muted hover:border-primary/30"
        >
          Next
          <ArrowRight className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}

export default async function PluginsPage(props: Props) {
  const params = await props.searchParams;

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Puzzle className="w-3 h-3" />
            Plugins
          </>
        }
        title="Plugins for"
        titleAccent="Bulwark."
        description="Hooks, UI extensions, and sidebar apps — add new features that integrate directly with the JMAP client."
      />

      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-14 py-12 sm:py-16">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchBar defaultQuery={params.q} placeholder="Search plugins..." />
          <Suspense>
            <SearchFilters type="plugin" sort={params.sort} tag={params.tag} />
          </Suspense>
        </div>

        <Suspense
          fallback={
            <div className="py-16 text-center text-muted-foreground text-[13px]">
              Loading plugins...
            </div>
          }
        >
          <PluginList searchParams={props.searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
