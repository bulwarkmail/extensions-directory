import { Suspense } from "react";
import { ArrowLeft, ArrowRight, Palette } from "lucide-react";
import { SearchBar, SearchFilters } from "@/components/search-bar";
import { ExtensionGrid } from "@/components/extension-grid";
import { PageHeader } from "@/components/page-header";
import { getExtensions } from "@/lib/db/queries";

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

export const metadata = {
  title: "Themes",
  description: "Browse themes for Bulwark Webmail",
};

async function ThemeList({ searchParams }: Props) {
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof getExtensions>>["data"] = [];
  let meta = { page: 1, perPage: 24, total: 0 };

  try {
    const result = await getExtensions({
      type: "theme",
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
        emptyTitle="No themes yet"
        emptyMessage="Submit the first community theme for Bulwark."
      />
      {meta.total > meta.perPage && (
        <div className="mt-10 flex items-center justify-center gap-2 text-[13px]">
          {meta.page > 1 && (
            <a
              href={`?page=${meta.page - 1}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 transition-colors hover:bg-muted hover:border-primary/30"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Previous
            </a>
          )}
          <span className="px-3 py-1.5 text-muted-foreground tabular-nums">
            Page {meta.page} of {pageCount}
          </span>
          {meta.page < pageCount && (
            <a
              href={`?page=${meta.page + 1}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 transition-colors hover:bg-muted hover:border-primary/30"
            >
              Next
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}
    </>
  );
}

export default async function ThemesPage(props: Props) {
  const params = await props.searchParams;

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Palette className="w-3 h-3" />
            Themes
          </>
        }
        title="Themes for"
        titleAccent="Bulwark."
        description="Customize fonts, colors, and layouts. Make the inbox feel like yours."
      />

      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-14 py-12 sm:py-16">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchBar defaultQuery={params.q} placeholder="Search themes..." />
          <Suspense>
            <SearchFilters type="theme" sort={params.sort} tag={params.tag} />
          </Suspense>
        </div>

        <Suspense
          fallback={
            <div className="py-16 text-center text-muted-foreground text-[13px]">
              Loading themes...
            </div>
          }
        >
          <ThemeList searchParams={props.searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
