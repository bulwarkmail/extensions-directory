import { Suspense } from "react";
import { BrowseToolbar } from "@/components/search-bar";
import { BrowseListing } from "@/components/browse-listing";
import { PageHeader } from "@/components/page-header";

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

export const metadata = {
  title: "Plugins",
  description: "Browse plugins for Bulwark Webmail",
};

export default async function PluginsPage(props: Props) {
  const params = await props.searchParams;

  return (
    <>
      <PageHeader
        compact
        title="Plugins"
        description="Plugins add toolbar buttons, sidebars, shortcuts and hooks to Bulwark Webmail, and talk to the server through a typed JMAP client."
      />
      <div className="bw-w" style={{ paddingBottom: 96 }}>
        <BrowseToolbar key={params.q ?? ""} kind="plugins" q={params.q} sort={params.sort} tag={params.tag} />
        <Suspense fallback={<p className="dx-count">Loading plugins…</p>}>
          <BrowseListing path="/plugins" params={params} type="plugin" />
        </Suspense>
      </div>
    </>
  );
}
