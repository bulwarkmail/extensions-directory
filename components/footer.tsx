import Link from "next/link";
import { ArrowUpRight, Github } from "lucide-react";
import { BulwarkMark } from "@/components/bulwark-mark";

const SANS = "var(--font-exo2), system-ui, sans-serif";
const SERIF = "var(--font-source-serif), 'Source Serif 4', Georgia, serif";
const MONO = "var(--font-jetbrains), ui-monospace, monospace";

const COLUMNS: { h: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    h: "Browse",
    links: [
      { label: "Plugins", href: "/plugins" },
      { label: "Themes", href: "/themes" },
      { label: "Search", href: "/search" },
    ],
  },
  {
    h: "Authors",
    links: [
      { label: "Submit an extension", href: "/submit" },
      { label: "Author dashboard", href: "/dashboard" },
      {
        label: "Developer docs",
        href: "https://bulwarkmail.org/docs/extensions/introduction",
        external: true,
      },
      {
        label: "Review guidelines",
        href: "https://bulwarkmail.org/docs/extensions/guidelines",
        external: true,
      },
    ],
  },
  {
    h: "Project",
    links: [
      {
        label: "GitHub",
        href: "https://github.com/bulwarkmail/Extensions",
        external: true,
      },
      { label: "Bulwark Webmail", href: "https://bulwarkmail.org", external: true },
      {
        label: "Stalwart",
        href: "https://stalw.art",
        external: true,
      },
    ],
  },
];

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="-2 -2 28 28"
      fill="currentColor"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <path d="M20.317 4.369A19.791 19.791 0 0 0 16.558 3.2a.074.074 0 0 0-.079.037c-.34.6-.719 1.384-.984 2a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.997-2 .077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 5.173 4.369a.07.07 0 0 0-.032.027C1.533 9.79.617 15.064 1.067 20.275a.083.083 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.042-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.371-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.245.198.372.292a.077.077 0 0 1-.006.128 12.299 12.299 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-6.025-.838-11.255-3.548-15.879a.061.061 0 0 0-.031-.028zM8.02 17.103c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer
      className="ed-on-navy relative px-5 sm:px-8 lg:px-14 pt-16 sm:pt-20 pb-7"
      style={{ background: "var(--navy)" }}
    >
      {/* hairline accent — raspberry stub + rule */}
      <div
        className="absolute left-5 sm:left-8 lg:left-14 right-5 sm:right-8 lg:right-14 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, var(--rasp) 0, var(--rasp) 96px, var(--rule-navy) 96px, var(--rule-navy) 100%)",
        }}
      />

      <div className="mx-auto max-w-[1440px]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr] gap-10 lg:gap-12 mb-14">
          <div>
            <div className="flex items-center gap-3.5 mb-4">
              <BulwarkMark size={32} color="var(--rasp)" />
              <span
                className="leading-none"
                style={{
                  fontFamily: SANS,
                  fontWeight: 800,
                  fontSize: 24,
                  letterSpacing: "-0.015em",
                  color: "var(--paper)",
                }}
              >
                Bulwark Extensions
              </span>
            </div>
            <p
              className="m-0 mb-6 max-w-[380px]"
              style={{
                fontFamily: SERIF,
                fontStyle: "italic",
                fontSize: 17,
                lineHeight: 1.55,
                color: "var(--paper)",
              }}
            >
              An open directory of free and open-source plugins and themes for Bulwark Webmail. Every extension is reviewed, OSI-licensed, and yours to install.
            </p>
          </div>

          {COLUMNS.map((c) => (
            <div key={c.h}>
              <div
                className="mb-4"
                style={{
                  color: "var(--rasp)",
                  fontStyle: "normal",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {c.h}
              </div>
              <ul className="list-none m-0 p-0 flex flex-col gap-3">
                {c.links.map((l) =>
                  l.external ? (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[color:var(--rasp)] transition-colors"
                        style={{
                          color: "var(--paper)",
                          fontFamily: SANS,
                          fontSize: 14,
                          textDecoration: "none",
                        }}
                      >
                        {l.label}
                      </a>
                    </li>
                  ) : (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="hover:text-[color:var(--rasp)] transition-colors"
                        style={{
                          color: "var(--paper)",
                          fontFamily: SANS,
                          fontSize: 14,
                          textDecoration: "none",
                        }}
                      >
                        {l.label}
                      </Link>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="flex flex-wrap justify-between items-baseline gap-4 pt-5"
          style={{ borderTop: "1px solid var(--rule-navy)", paddingTop: 22 }}
        >
          <div className="flex items-baseline gap-4 flex-wrap">
            <span className="ed-folio" style={{ color: "var(--muted-navy)" }}>
              © {year} Bulwark Mail · Open directory · OSI-licensed extensions only
            </span>
          </div>
          <div className="flex items-center gap-5 flex-wrap">
            {[
              {
                label: "GitHub",
                href: "https://github.com/bulwarkmail/Extensions",
                icon: <Github className="w-3.5 h-3.5" />,
              },
              {
                label: "Discord",
                href: "https://discord.com/invite/tYCujymGrT",
                icon: <DiscordIcon className="w-3.5 h-3.5" />,
              },
              {
                label: "Bulwark Webmail",
                href: "https://bulwarkmail.org",
              },
            ].map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-[color:var(--rasp)] transition-colors"
                style={{
                  fontFamily: SANS,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--paper)",
                  textDecoration: "none",
                }}
              >
                {l.icon}
                {l.label}
                <ArrowUpRight className="w-3 h-3" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
