import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleCheck, Eye, Github, Shield } from "lucide-react";

import { SearchBar } from "@/components/search-bar";
import { ExtensionGrid } from "@/components/extension-grid";
import { ExtensionRows } from "@/components/extension-rows";
import { ICON } from "@/components/icon";
import { formatDownloads, timeAgo } from "@/lib/utils";
import {
  getFeaturedExtensions,
  getUpdatedExtensions,
  getPopularExtensions,
  getStats,
} from "@/lib/db/queries";

// Render fresh on every request so newly-approved extensions and updated
// stats appear immediately.
export const dynamic = "force-dynamic";

type Listing = Awaited<ReturnType<typeof getFeaturedExtensions>>;

const FACTS = [
  { icon: Github, title: "Open source only", text: "Each extension has an OSI licence and a public repository." },
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
    title: "Publish an extension",
    text: "Push a tag from GitHub Actions, or name a repository and a tag here.",
    href: "/publishing",
  },
];

function SectionHead({ title, link, href }: { title: string; link: string; href: string }) {
  return (
    <div className="dx-sec-head">
      <h2 className="bw-h2">{title}</h2>
      <Link href={href} className="bw-tlink">
        {link}
        <ArrowRight size={16} {...ICON} />
      </Link>
    </div>
  );
}

export default async function HomePage() {
  let featured: Listing = [];
  let updated: Listing = [];
  let popular: Listing = [];
  let stats = { extensions: 0, plugins: 0, themes: 0, authors: 0, totalDownloads: 0 };

  try {
    [featured, updated, popular, stats] = await Promise.all([
      getFeaturedExtensions(6),
      getUpdatedExtensions(6),
      getPopularExtensions(6),
      getStats(),
    ]);
  } catch {
    // DB not available — render the empty state
  }

  const isEmpty = featured.length === 0 && updated.length === 0 && popular.length === 0;

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

      <section className="bw-field">
        <div className="bw-w dx-hero dx-home-hero">
          <h1 className="bw-h1">Plugins and themes for Bulwark Webmail.</h1>
          <p className="bw-lead">
            Every extension is free, open source and reviewed before it is published. Install it on your own Bulwark
            from here.
          </p>
          <SearchBar onField />
          <p className="dx-hero-links">
            <Link href="/plugins">
              {stats.plugins.toLocaleString()} {stats.plugins === 1 ? "plugin" : "plugins"}
              <ArrowRight size={16} {...ICON} />
            </Link>
            <Link href="/themes">
              {stats.themes.toLocaleString()} {stats.themes === 1 ? "theme" : "themes"}
              <ArrowRight size={16} {...ICON} />
            </Link>
          </p>
        </div>
      </section>

      <section className="bw-w dx-facts-row">
        <div className="bw-facts">
          {FACTS.map(({ icon: Icon, title, text }) => (
            <div key={title}>
              <Icon size={22} {...ICON} />
              <h2 className="bw-h3">{title}</h2>
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
          {featured.length > 0 ? (
            <section className="bw-w dx-sec">
              <SectionHead title="Featured by the reviewers." link="Browse everything" href="/search?sort=downloads" />
              {/* Whole rows only: three columns, so a multiple of three. */}
              <ExtensionGrid extensions={featured.length > 3 ? featured.slice(0, featured.length - (featured.length % 3)) : featured} />
            </section>
          ) : null}

          <section className="bw-w dx-sec">
            <div className="dx-two">
              {updated.length > 0 ? (
                <div>
                  <SectionHead title="Recently updated." link="All by update" href="/search?sort=updated" />
                  <ExtensionRows
                    rows={updated}
                    fact={(r) => `${r.latestVersion ? `${r.latestVersion}, ` : ""}${timeAgo(r.updatedAt)}`}
                  />
                </div>
              ) : null}
              {popular.length > 0 ? (
                <div>
                  <SectionHead title="Most downloaded." link="All by downloads" href="/search?sort=downloads" />
                  <ExtensionRows
                    rows={popular}
                    fact={(r) => `${formatDownloads(r.totalDownloads ?? 0)} ${r.totalDownloads === 1 ? "download" : "downloads"}`}
                  />
                </div>
              ) : null}
            </div>
          </section>
        </>
      )}

      <section className="bw-band">
        <div className="bw-w dx-sec">
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
                <a key={t.title} href={t.href} target="_blank" rel="noopener noreferrer" className="bw-tile dx-build-tile">
                  {body}
                </a>
              ) : (
                <Link key={t.title} href={t.href} className="bw-tile dx-build-tile">
                  {body}
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
