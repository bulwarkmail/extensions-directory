import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ICON } from "@/components/icon";

const TILES = [
  { title: "Plugins", text: "Toolbar buttons, sidebars, shortcuts and hooks.", href: "/plugins" },
  { title: "Themes", text: "Fonts, colours and density for the whole interface.", href: "/themes" },
  { title: "Submit an extension", text: "Publish a plugin or theme from GitHub.", href: "/submit" },
  { title: "Developer docs", text: "The extension API and manifest.", href: "https://bulwarkmail.org/docs/extensions/introduction" },
];

export default function NotFound() {
  return (
    <>
      <PageHeader
        title="This page does not exist."
        description="Error 404. The address may be mistyped, or the extension may have been renamed or taken down."
      >
        <Link href="/" className="bw-btn">
          Go to the home page
          <ArrowRight size={16} {...ICON} />
        </Link>
        <Link href="/search" className="bw-btn bw-btn-ghost">
          Search extensions
          <ArrowRight size={16} {...ICON} />
        </Link>
      </PageHeader>
      <section className="bw-w dx-sec">
        <div className="bw-head">
          <h2 className="bw-h2">Pages people look for most.</h2>
        </div>
        <div className="bw-tiles">
          {TILES.map((t) => {
            const external = t.href.startsWith("http");
            const body = (
              <>
                <span className="bw-tile-title">{t.title}</span>
                <span className="bw-tile-text">{t.text}</span>
                <span className="bw-tile-arrow">
                  {external ? <ArrowUpRight size={20} {...ICON} /> : <ArrowRight size={20} {...ICON} />}
                </span>
              </>
            );
            return external ? (
              <a key={t.title} href={t.href} target="_blank" rel="noopener noreferrer" className="bw-tile">
                {body}
              </a>
            ) : (
              <Link key={t.title} href={t.href} className="bw-tile">
                {body}
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}
