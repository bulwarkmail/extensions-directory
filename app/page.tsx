import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Download,
  Github,
  Palette,
  Puzzle,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";

import { SearchBar } from "@/components/search-bar";
import { ExtensionGrid } from "@/components/extension-grid";
import { BulwarkMark } from "@/components/bulwark-mark";
import {
  getFeaturedExtensions,
  getRecentExtensions,
  getPopularExtensions,
  getStats,
} from "@/lib/db/queries";

// Render fresh on every request so newly-approved extensions and updated
// stats appear immediately.
export const dynamic = "force-dynamic";

const SANS = "var(--font-exo2), system-ui, sans-serif";
const SERIF = "var(--font-source-serif), 'Source Serif 4', Georgia, serif";
const MONO = "var(--font-jetbrains), ui-monospace, monospace";

const HERO_TITLE = ["Extend", "Bulwark,", "your way."];
const HERO_ACCENT_RANGE: [number, number] = [2, 3]; // "your way."
const HERO_DECK =
  "Plugins and themes that snap into Bulwark Webmail. Free, open source, reviewed for every release — add new workflows, repaint the inbox, or build the extension you've been waiting for.";

function HeroTitle() {
  const words = HERO_TITLE.join(" ").split(" ");
  const [from, to] = HERO_ACCENT_RANGE;
  return (
    <>
      {words.map((w, i) => {
        const inRange = i >= from && i <= to;
        const trailingBreak = i === 1; // after "Bulwark,"
        return (
          <span key={i}>
            <span className={inRange ? "ed-hero-underline" : undefined}>{w}</span>
            {i < words.length - 1 ? (trailingBreak ? <br /> : " ") : null}
          </span>
        );
      })}
    </>
  );
}

// -----------------------------------------------------------------------------
// SECTION: Hero
// -----------------------------------------------------------------------------
function HeroSection({
  stats,
}: {
  stats: { extensions: number; plugins: number; themes: number; authors: number; totalDownloads: number };
}) {
  return (
    <section className="relative overflow-hidden px-5 sm:px-8 lg:px-14 pt-16 sm:pt-24 pb-14 sm:pb-20">
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{ top: 120, right: -800, opacity: 0.07, zIndex: 0 }}
      >
        <BulwarkMark size={1600} color="var(--rasp)" />
      </div>
      <div className="relative mx-auto max-w-[1440px]" style={{ zIndex: 1 }}>
        <h1
          className="ed-display animate-fade-in-up text-foreground"
          style={{
            fontFamily: SANS,
            fontWeight: 800,
            letterSpacing: "-0.045em",
            lineHeight: 0.92,
            fontSize: "clamp(2.75rem, 11vw, 9.75rem)",
            maxWidth: 1300,
          }}
        >
          <HeroTitle />
        </h1>

        <div
          className="mt-10 sm:mt-14 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-10 lg:gap-20 items-end animate-fade-in-up"
          style={{ animationDelay: "0.1s" }}
        >
          <p
            className="text-foreground/70"
            style={{
              fontFamily: SANS,
              fontWeight: 400,
              fontSize: "clamp(1.05rem, 1.5vw, 1.3rem)",
              lineHeight: 1.45,
              maxWidth: 700,
            }}
          >
            {HERO_DECK}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/plugins" className="ed-cta-primary">
              Browse plugins <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/submit" className="ed-cta-ghost">
              <Upload className="w-4 h-4" />
              Submit yours
            </Link>
          </div>
        </div>

        <div
          className="mt-12 sm:mt-16 animate-fade-in-up"
          style={{ animationDelay: "0.2s" }}
        >
          <SearchBar placeholder="Search plugins, themes, authors..." />
        </div>

        {/* Stats strip */}
        <div className="mt-14 sm:mt-20 pt-6 border-t border-[color:var(--rule)]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-10">
            <StatCell
              icon={<Puzzle className="w-3 h-3" />}
              label="Extensions"
              value={stats.extensions}
            />
            <StatCell
              icon={<Palette className="w-3 h-3" />}
              label="Themes"
              value={stats.themes}
            />
            <StatCell
              icon={<Users className="w-3 h-3" />}
              label="Authors"
              value={stats.authors}
            />
            <StatCell
              icon={<Download className="w-3 h-3" />}
              label="Downloads"
              value={stats.totalDownloads}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span
        className="inline-flex items-center gap-1.5 text-foreground/65"
        style={{
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {icon}
        {label}
      </span>
      <div
        className="text-foreground tabular-nums"
        style={{
          fontFamily: SANS,
          fontWeight: 800,
          letterSpacing: "-0.025em",
          lineHeight: 1,
          fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
        }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SECTION: Featured row
// -----------------------------------------------------------------------------
function ListingSection({
  eyebrow,
  title,
  titleAccent,
  href,
  extensions,
}: {
  eyebrow: string;
  title: string;
  titleAccent?: string;
  href?: string;
  extensions: Awaited<ReturnType<typeof getFeaturedExtensions>>;
}) {
  if (extensions.length === 0) return null;
  return (
    <section className="px-5 sm:px-8 lg:px-14 py-14 sm:py-20 border-b border-[color:var(--rule)]">
      <div className="mx-auto max-w-[1440px]">
        <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
          <div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--rasp)",
                marginBottom: 14,
              }}
            >
              {eyebrow}
            </div>
            <h2
              className="text-foreground"
              style={{
                fontFamily: SANS,
                fontWeight: 800,
                letterSpacing: "-0.035em",
                lineHeight: 0.98,
                margin: 0,
                fontSize: "clamp(1.875rem, 4vw, 3.25rem)",
              }}
            >
              {title}
              {titleAccent ? (
                <>
                  {" "}
                  <span
                    style={{
                      color: "var(--rasp)",
                      fontFamily: SERIF,
                      fontStyle: "italic",
                      fontWeight: 400,
                    }}
                  >
                    {titleAccent}
                  </span>
                </>
              ) : null}
            </h2>
          </div>
          {href && (
            <Link
              href={href}
              className="inline-flex items-center gap-1.5 text-foreground"
              style={{
                fontFamily: MONO,
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.04em",
                borderBottom: "1.5px solid var(--rasp)",
                paddingBottom: 4,
              }}
            >
              SEE ALL <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
        <ExtensionGrid extensions={extensions} />
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// SECTION: Two flavors — plugins + themes (on-navy)
// -----------------------------------------------------------------------------
function FlavorsSection({
  stats,
}: {
  stats: { plugins: number; themes: number };
}) {
  return (
    <section className="ed-section ed-on-navy relative overflow-hidden">
      <div
        className="absolute pointer-events-none"
        style={{
          top: -200,
          right: -200,
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(219,45,84,0.20) 0%, transparent 60%)",
        }}
      />
      <div className="mx-auto max-w-[1440px] relative">
        <h2
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            letterSpacing: "-0.035em",
            lineHeight: 0.98,
            margin: "0 0 28px",
            maxWidth: 1100,
            fontSize: "clamp(2rem, 6vw, 5.5rem)",
            color: "var(--paper)",
          }}
        >
          Plugins and themes,
          <br />
          <span
            style={{
              color: "var(--rasp)",
              fontFamily: SERIF,
              fontStyle: "italic",
              fontWeight: 400,
            }}
          >
            no lock-in.
          </span>
        </h2>
        <p
          style={{
            fontFamily: SANS,
            fontSize: "clamp(1rem, 1.4vw, 1.1875rem)",
            lineHeight: 1.5,
            color: "var(--muted-navy)",
            maxWidth: 760,
            margin: "0 0 56px",
          }}
        >
          Two kinds of extension, one directory. Every published extension is reviewed against the same set of rules and shipped from the same signed bundle endpoint.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
          <FlavorBlock
            kicker="Plugins"
            count={stats.plugins}
            title="Logic and UI you wire into the client"
            description="Drop new buttons, sidebars, and keyboard shortcuts into Bulwark Webmail — or hook the send / receive lifecycle to ship whole workflows."
            features={[
              "Toolbar, sidebar, and composer extensions",
              "Hooks for the send / receive lifecycle",
              "Calendar action integrations (Jitsi Meet, BBB, …)",
              "Typed JMAP client API, no raw HTTP",
            ]}
            cta="Browse plugins"
            href="/plugins"
          />
          <FlavorBlock
            kicker="Themes"
            count={stats.themes}
            title="Pure-CSS skins for the whole inbox"
            description="Override Bulwark's design tokens to repaint fonts, colors, density, and accents. Zero JavaScript at runtime."
            features={[
              "CSS variables for the whole interface",
              "Light + dark variants in one bundle",
              "Auto-switches with the system theme",
              "Tiny payload — usually under 5 KB",
            ]}
            cta="Browse themes"
            href="/themes"
          />
        </div>
      </div>
    </section>
  );
}

function FlavorBlock({
  kicker,
  count,
  title,
  description,
  features,
  cta,
  href,
}: {
  kicker: string;
  count: number;
  title: string;
  description: string;
  features: string[];
  cta: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col pt-9 border-t-2 transition-colors"
      style={{ borderColor: "var(--paper)" }}
    >
      <div
        className="flex items-baseline justify-between gap-4 mb-6"
        style={{ color: "var(--paper)" }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--rasp)",
            fontWeight: 600,
          }}
        >
          {kicker}
        </span>
        <span
          className="tabular-nums"
          style={{
            fontFamily: SANS,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            fontSize: "clamp(2.5rem, 5vw, 4rem)",
            lineHeight: 0.9,
            color: "var(--paper)",
          }}
        >
          {count.toLocaleString()}
        </span>
      </div>
      <h3
        style={{
          fontFamily: SANS,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
          fontSize: "clamp(1.5rem, 2.2vw, 2rem)",
          color: "var(--paper)",
          margin: "0 0 14px",
        }}
      >
        {title}
      </h3>
      <p
        className="mb-6"
        style={{
          fontFamily: SERIF,
          fontSize: 17,
          lineHeight: 1.6,
          color: "var(--muted-navy)",
          margin: "0 0 24px",
          maxWidth: 520,
        }}
      >
        {description}
      </p>
      <ul className="list-none m-0 p-0 mb-8 border-t" style={{ borderColor: "var(--rule-navy)" }}>
        {features.map((f) => (
          <li
            key={f}
            className="py-2.5 border-b grid grid-cols-[auto_1fr] gap-3 items-baseline"
            style={{ borderColor: "var(--rule-navy)" }}
          >
            <span
              aria-hidden
              style={{
                display: "block",
                width: 6,
                height: 6,
                background: "var(--rasp)",
                marginTop: 4,
              }}
            />
            <span
              style={{
                fontFamily: SANS,
                fontSize: 14,
                color: "var(--paper)",
                lineHeight: 1.45,
              }}
            >
              {f}
            </span>
          </li>
        ))}
      </ul>
      <div
        className="mt-auto inline-flex items-center gap-1.5 group-hover:gap-2 transition-all"
        style={{
          fontFamily: MONO,
          fontSize: 12,
          fontWeight: 500,
          color: "var(--paper)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          borderBottom: "1.5px solid var(--rasp)",
          paddingBottom: 4,
          width: "fit-content",
        }}
      >
        {cta} <ArrowRight className="w-3.5 h-3.5" />
      </div>
    </Link>
  );
}

// -----------------------------------------------------------------------------
// SECTION: Build & ship strip
// -----------------------------------------------------------------------------
function BuildSection() {
  const tiles: { tag: string; title: string; titleAccent: string; href: string; external?: boolean; meta: string; body: string }[] = [
    {
      tag: "Documentation",
      title: "Read the",
      titleAccent: "developer docs.",
      href: "https://bulwarkmail.org/docs/extensions/introduction",
      external: true,
      meta: "API reference · manifest schema\nhook lifecycle · examples",
      body:
        "The extension API surface is small — a typed JMAP client, a handful of UI slots, and a manifest. Read it cover-to-cover in an afternoon.",
    },
    {
      tag: "Guidelines",
      title: "Know the",
      titleAccent: "review rules.",
      href: "https://bulwarkmail.org/docs/extensions/guidelines",
      external: true,
      meta: "OSI license required\nno minification · no telemetry",
      body:
        "Every submission goes through an automated code scan and a human reviewer. The rules are short and public — read them before you submit so the review is a formality.",
    },
    {
      tag: "Publish",
      title: "Submit your",
      titleAccent: "extension.",
      href: "/submit",
      meta: "Sign in with GitHub\nrepo + tag + manifest.json",
      body:
        "Sign in with GitHub, point us at a public repo, pick a tag. We fetch the bundle, run the scan, queue it for review. You get notified on the same GitHub account.",
    },
  ];
  return (
    <section className="px-5 sm:px-8 lg:px-14 py-14 sm:py-20 border-b border-[color:var(--rule)]">
      <div className="mx-auto max-w-[1440px]">
        <h2
          className="text-foreground mb-12"
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            letterSpacing: "-0.035em",
            lineHeight: 0.98,
            margin: "0 0 48px",
            maxWidth: 1100,
            fontSize: "clamp(2rem, 5vw, 4.5rem)",
          }}
        >
          Build something{" "}
          <span
            style={{
              color: "var(--rasp)",
              fontFamily: SERIF,
              fontStyle: "italic",
              fontWeight: 400,
            }}
          >
            worth installing.
          </span>
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-12">
          {tiles.map((t) => {
            const inner = (
              <>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "var(--rasp)",
                    fontWeight: 600,
                    marginBottom: 14,
                  }}
                >
                  {t.tag}
                </div>
                <h3
                  className="text-foreground"
                  style={{
                    fontFamily: SANS,
                    fontWeight: 800,
                    letterSpacing: "-0.025em",
                    lineHeight: 1,
                    fontSize: "clamp(1.5rem, 2.4vw, 2rem)",
                    margin: "0 0 14px",
                  }}
                >
                  {t.title}
                  <br />
                  <span
                    style={{
                      color: "var(--rasp)",
                      fontFamily: SERIF,
                      fontStyle: "italic",
                      fontWeight: 400,
                    }}
                  >
                    {t.titleAccent}
                  </span>
                </h3>
                <p
                  className="ed-folio mb-5"
                  style={{ whiteSpace: "pre-line", color: "var(--muted-paper)" }}
                >
                  {t.meta}
                </p>
                <p
                  className="text-foreground"
                  style={{
                    fontFamily: SERIF,
                    fontSize: 16,
                    lineHeight: 1.6,
                    margin: 0,
                  }}
                >
                  {t.body}
                </p>
                <div
                  className="mt-6 inline-flex items-center gap-1.5 text-foreground"
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: "0.04em",
                    borderBottom: "1.5px solid var(--rasp)",
                    paddingBottom: 4,
                  }}
                >
                  {t.external ? (
                    <>
                      OPEN <ArrowUpRight className="w-3.5 h-3.5" />
                    </>
                  ) : (
                    <>
                      GO <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </div>
              </>
            );
            const className = "group block pt-9 border-t-2 border-foreground";
            return t.external ? (
              <a
                key={t.tag}
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
              >
                {inner}
              </a>
            ) : (
              <Link key={t.tag} href={t.href} className={className}>
                {inner}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// SECTION: Empty state (when no extensions yet)
// -----------------------------------------------------------------------------
function EmptyState() {
  return (
    <section className="px-5 sm:px-8 lg:px-14 py-20 sm:py-28 border-b border-[color:var(--rule)] text-center">
      <div className="mx-auto max-w-[820px]">
        <div
          className="ed-eyebrow mb-5"
          style={{ color: "var(--rasp)", letterSpacing: "0.22em" }}
        >
          Empty shelves
        </div>
        <h2
          className="text-foreground"
          style={{
            fontFamily: SANS,
            fontWeight: 800,
            letterSpacing: "-0.045em",
            lineHeight: 0.95,
            fontSize: "clamp(2rem, 5vw, 4.5rem)",
            margin: "0 0 24px",
          }}
        >
          The directory is{" "}
          <span
            style={{
              color: "var(--rasp)",
              fontFamily: SERIF,
              fontStyle: "italic",
              fontWeight: 400,
            }}
          >
            just getting started.
          </span>
        </h2>
        <p
          className="text-foreground/70 max-w-xl mx-auto"
          style={{ fontFamily: SERIF, fontSize: 17, lineHeight: 1.55 }}
        >
          Be the first to publish a plugin or theme. We review every submission and publish the ones that meet our open source and quality guidelines.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href="/submit" className="ed-cta-primary">
            <Upload className="w-4 h-4" />
            Submit extension
          </Link>
          <a
            href="https://bulwarkmail.org/docs/extensions/introduction"
            target="_blank"
            rel="noopener noreferrer"
            className="ed-cta-ghost"
          >
            <BookOpen className="w-4 h-4" />
            Read the docs
          </a>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// SECTION: Final CTA on navy
// -----------------------------------------------------------------------------
function FinalCtaSection() {
  return (
    <section
      className="ed-section ed-on-navy"
      style={{ borderTop: "4px double var(--rasp)" }}
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-10 lg:gap-20 items-end">
          <h2
            style={{
              fontFamily: SANS,
              fontWeight: 800,
              letterSpacing: "-0.045em",
              lineHeight: 0.9,
              margin: 0,
              fontSize: "clamp(2.5rem, 9vw, 7.5rem)",
              color: "var(--paper)",
            }}
          >
            Ship the{" "}
            <span
              style={{
                color: "var(--rasp)",
                fontFamily: SERIF,
                fontWeight: 400,
                fontStyle: "italic",
              }}
            >
              extension
            </span>
            <br />
            you&apos;ve been{" "}
            <span
              style={{
                color: "var(--rasp)",
                fontFamily: SERIF,
                fontWeight: 400,
                fontStyle: "italic",
              }}
            >
              waiting for.
            </span>
          </h2>
          <div className="flex flex-col">
            <Link
              href="/submit"
              className="ed-cta-primary"
              style={{
                justifyContent: "space-between",
                padding: "20px 24px",
                fontSize: 17,
              }}
            >
              <span className="inline-flex items-center gap-2">
                <Upload className="w-5 h-5" /> Submit yours
              </span>
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="https://github.com/bulwarkmail/Extensions"
              target="_blank"
              rel="noopener noreferrer"
              className="ed-cta-ghost"
              style={{
                justifyContent: "space-between",
                color: "var(--paper)",
                borderColor: "var(--paper)",
                padding: "19px 24px",
                fontSize: 17,
                marginTop: 0,
              }}
            >
              <span className="inline-flex items-center gap-2">
                <Github className="w-4 h-4" /> View on GitHub
              </span>
              <ArrowUpRight className="w-5 h-5" />
            </a>
            <a
              href="https://bulwarkmail.org/docs/extensions/guidelines"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2"
              style={{
                fontFamily: MONO,
                fontSize: 12,
                color: "var(--muted-navy)",
                textDecoration: "none",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Review guidelines first
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// PAGE
// =============================================================================
export default async function HomePage() {
  let featured: Awaited<ReturnType<typeof getFeaturedExtensions>> = [];
  let recent: Awaited<ReturnType<typeof getRecentExtensions>> = [];
  let popular: Awaited<ReturnType<typeof getPopularExtensions>> = [];
  let stats = { extensions: 0, plugins: 0, themes: 0, authors: 0, totalDownloads: 0 };

  try {
    [featured, recent, popular, stats] = await Promise.all([
      getFeaturedExtensions(),
      getRecentExtensions(),
      getPopularExtensions(),
      getStats(),
    ]);
  } catch {
    // DB not available — render empty state
  }

  const isEmpty =
    featured.length === 0 && recent.length === 0 && popular.length === 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Bulwark Extensions",
    description:
      "An open directory of plugins and themes for Bulwark Webmail. Every extension is free, open source, and reviewed.",
    url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://extensions.bulwarkmail.org",
  };

  return (
    <div className="bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <HeroSection stats={stats} />

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <ListingSection
            eyebrow="Hand-picked"
            title="Featured"
            titleAccent="this week."
            extensions={featured}
            href="/search?sort=downloads"
          />
          <ListingSection
            eyebrow="Fresh ink"
            title="Recently"
            titleAccent="added."
            extensions={recent}
            href="/search?sort=newest"
          />
          <ListingSection
            eyebrow="Trending"
            title="Most"
            titleAccent="installed."
            extensions={popular}
            href="/search?sort=downloads"
          />
        </>
      )}

      <FlavorsSection stats={stats} />
      <BuildSection />
      <FinalCtaSection />
    </div>
  );
}
