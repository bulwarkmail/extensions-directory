import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleCheck, Eye, Github, Palette, Puzzle, Shield } from "lucide-react";

import { SearchBar } from "@/components/search-bar";
import { ExtensionGrid } from "@/components/extension-grid";
import { PageHeader } from "@/components/page-header";
import { ICON } from "@/components/icon";
import {
  getFeaturedExtensions,
  getRecentExtensions,
  getPopularExtensions,
  getStats,
} from "@/lib/db/queries";

// Render fresh on every request so newly-approved extensions and updated
// stats appear immediately.
export const dynamic = "force-dynamic";

// Six per section keeps the three-column grid full.
const PER_SECTION = 6;

type Listing = Awaited<ReturnType<typeof getFeaturedExtensions>>;

function ListingSection({
  title,
  link,
  href,
  extensions,
}: {
  title: string;
  link: string;
  href: string;
  extensions: Listing;
}) {
  if (extensions.length === 0) return null;
  return (
    <section className="bw-w dx-sec">
      <div className="dx-sec-head">
        <h2 className="bw-h2">{title}</h2>
        <Link href={href} className="bw-tlink">
          {link}
          <ArrowRight size={16} {...ICON} />
        </Link>
      </div>
      <ExtensionGrid extensions={extensions} />
    </section>
  );
}

const FACTS = [
  { icon: Github, title: "Open source only", text: "Each extension has an OSI licence and a public GitHub repository." },
  { icon: CircleCheck, title: "Reviewed before release", text: "An automated scan and a reviewer check every version." },
  { icon: Eye, title: "Readable code", text: "No minified or obfuscated code, and no telemetry." },
  { icon: Shield, title: "Permissions up front", text: "Each plugin lists what it can read and change." },
];

const BUILD = [
  {
    title: "Developer docs",
    text: "API reference, manifest schema, hook lifecycle and examples.",
    href: "https://bulwarkmail.org/docs/extensions/introduction",
  },
  {
    title: "Review guidelines",
    text: "OSI licence required, no minification, no telemetry.",
    href: "https://bulwarkmail.org/docs/extensions/guidelines",
  },
  {
    title: "Submit an extension",
    text: "Sign in with GitHub, name a public repository and a tag.",
    href: "/submit",
  },
];

export default async function HomePage() {
  let featured: Listing = [];
  let recent: Listing = [];
  let popular: Listing = [];
  let stats = { extensions: 0, plugins: 0, themes: 0, authors: 0, totalDownloads: 0 };

  try {
    [featured, recent, popular, stats] = await Promise.all([
      getFeaturedExtensions(PER_SECTION),
      getRecentExtensions(PER_SECTION),
      getPopularExtensions(PER_SECTION),
      getStats(),
    ]);
  } catch {
    // DB not available — render the empty state
  }

  const isEmpty = featured.length === 0 && recent.length === 0 && popular.length === 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Bulwark Extensions",
    description:
      "An open directory of plugins and themes for Bulwark Webmail. Every extension is free, open source, and reviewed.",
    url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://extensions.bulwarkmail.org",
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <PageHeader
        title="Plugins and themes for Bulwark Webmail."
        description="Every extension here is free, open source and reviewed before it is published. Download the bundle and install it from the ZIP."
      >
        <Link href="/plugins" className="bw-btn">
          Browse plugins
          <ArrowRight size={16} {...ICON} />
        </Link>
        <Link href="/submit" className="bw-btn bw-btn-ghost">
          Submit an extension
          <ArrowRight size={16} {...ICON} />
        </Link>
      </PageHeader>

      <section className="bw-w" style={{ paddingTop: 40 }}>
        <SearchBar />
        <div className="bw-facts" style={{ marginTop: 56 }}>
          {FACTS.map(({ icon: Icon, title, text }) => (
            <div key={title}>
              <Icon size={24} {...ICON} />
              <h3 className="bw-h3">{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      {isEmpty ? (
        <section className="bw-w dx-sec">
          <div className="dx-empty">
            <h2 className="bw-h2">The directory has no extensions yet.</h2>
            <p>
              Submit the first plugin or theme. Every submission is reviewed, and the ones that meet the open source and
              quality guidelines are published.
            </p>
            <div className="bw-btns">
              <Link href="/submit" className="bw-btn">
                Submit an extension
                <ArrowRight size={16} {...ICON} />
              </Link>
              <a
                href="https://bulwarkmail.org/docs/extensions/introduction"
                target="_blank"
                rel="noopener noreferrer"
                className="bw-btn bw-btn-ghost"
              >
                Read the docs
                <ArrowUpRight size={16} {...ICON} />
              </a>
            </div>
          </div>
        </section>
      ) : (
        <>
          <ListingSection
            title="Featured by the reviewers."
            link="Browse every extension"
            href="/search?sort=downloads"
            extensions={featured}
          />
          <ListingSection title="Recently added." link="Newest first" href="/search?sort=newest" extensions={recent} />
          <ListingSection
            title="Most downloaded."
            link="Most downloaded first"
            href="/search?sort=downloads"
            extensions={popular}
          />
        </>
      )}

      <section className="bw-band">
        <div className="bw-w dx-sec">
          <div className="bw-head">
            <h2 className="bw-h2">Two kinds of extension.</h2>
            <p>Plugins add features through a typed JMAP client. Themes restyle the whole interface with CSS alone.</p>
          </div>
          <div className="bw-tiles bw-tiles-2">
            <Link href="/plugins" className="bw-tile">
              <Puzzle size={24} className="bw-tile-icon" {...ICON} />
              <span className="bw-tile-title">
                {stats.plugins.toLocaleString()} {stats.plugins === 1 ? "plugin" : "plugins"}
              </span>
              <span className="bw-tile-text">
                Toolbar, sidebar and composer extensions, hooks for sending and receiving, and calendar actions.
              </span>
              <span className="bw-tile-arrow">
                <ArrowRight size={20} {...ICON} />
              </span>
            </Link>
            <Link href="/themes" className="bw-tile">
              <Palette size={24} className="bw-tile-icon" {...ICON} />
              <span className="bw-tile-title">
                {stats.themes.toLocaleString()} {stats.themes === 1 ? "theme" : "themes"}
              </span>
              <span className="bw-tile-text">
                CSS variables for the whole interface, light and dark in one bundle, usually under 5 KB.
              </span>
              <span className="bw-tile-arrow">
                <ArrowRight size={20} {...ICON} />
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="bw-w dx-sec">
        <div className="bw-head">
          <h2 className="bw-h2">Build an extension.</h2>
          <p>The API is a typed JMAP client, a handful of interface slots and a manifest. The review rules are short and public.</p>
        </div>
        <div className="bw-tiles bw-tiles-3">
          {BUILD.map((t) => {
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
