import Link from "next/link";
import { BulwarkMark } from "@/components/bulwark-mark";

// Same structure as repos/website/src/components/footer.tsx: the mark and one
// sentence, link columns with sentence-case heads, then a legal line.
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
      { label: "Developer docs", href: "https://bulwarkmail.org/docs/extensions/introduction", external: true },
      { label: "Review guidelines", href: "https://bulwarkmail.org/docs/extensions/guidelines", external: true },
    ],
  },
  {
    h: "Project",
    links: [
      { label: "Bulwark Webmail", href: "https://bulwarkmail.org", external: true },
      { label: "GitHub", href: "https://github.com/bulwarkmail/Extensions", external: true },
      { label: "Discord", href: "https://discord.com/invite/tYCujymGrT", external: true },
      { label: "Stalwart", href: "https://stalw.art", external: true },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="bw-foot">
      <div className="bw-w">
        <div className="bw-foot-in">
          <div className="bw-foot-brand">
            <Link href="/" className="bw-brandmark">
              <BulwarkMark size={24} />
              <span>
                Bulwark <span className="dx-wordmark-sub">Extensions</span>
              </span>
            </Link>
            <p>
              An open directory of free, open-source plugins and themes for Bulwark Webmail. Every extension is reviewed
              and carries an OSI licence.
            </p>
          </div>

          {COLUMNS.map((c) => (
            <div key={c.h}>
              <h3>{c.h}</h3>
              <ul>
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href}>{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="bw-foot-legal">
          <span>© {year} Bulwark Mail</span>
          <span>OSI-licensed extensions only</span>
          <a href="https://bulwarkmail.org" target="_blank" rel="noopener noreferrer">
            bulwarkmail.org
          </a>
        </div>
      </div>
    </footer>
  );
}
