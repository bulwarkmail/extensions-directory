import { Suspense } from "react";
import { BrowseToolbar } from "@/components/search-bar";
import { BrowseListing } from "@/components/browse-listing";
import { PageHeader } from "@/components/page-header";

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

export const metadata = {
  title: "Themes",
  description: "Browse themes for Bulwark Webmail",
};

export default async function ThemesPage(props: Props) {
  const params = await props.searchParams;

  return (
    <>
      <PageHeader
        compact
        title="Themes"
        description="Themes restyle Bulwark Webmail with CSS variables: fonts, colours, density and accents, in light and dark."
      />
      <div className="bw-w" style={{ paddingBottom: 96 }}>
        <BrowseToolbar key={params.q ?? ""} kind="themes" q={params.q} sort={params.sort} tag={params.tag} />
        <Suspense fallback={<p className="dx-count">Loading themes…</p>}>
          <BrowseListing path="/themes" params={params} type="theme" />
        </Suspense>
      </div>
    </>
  );
}
