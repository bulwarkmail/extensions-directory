import { Suspense } from "react";
import { BrowseToolbar } from "@/components/search-bar";
import { BrowseListing } from "@/components/browse-listing";
import { PageHeader } from "@/components/page-header";

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

export const metadata = {
  title: "Search",
};

export default async function SearchPage(props: Props) {
  const params = await props.searchParams;
  const type = params.type === "plugin" || params.type === "theme" ? params.type : undefined;

  return (
    <>
      <PageHeader compact title="Search" description="Find plugins and themes by name or description." />
      <div className="bw-w" style={{ paddingBottom: 96 }}>
        <BrowseToolbar key={params.q ?? ""} kind="search" q={params.q} sort={params.sort} tag={params.tag} type={type} />
        <Suspense fallback={<p className="dx-count">Searching…</p>}>
          <BrowseListing path="/search" params={params} type={type} />
        </Suspense>
      </div>
    </>
  );
}
