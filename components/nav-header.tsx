"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ArrowUpRight, Github, Menu, Moon, Sun, X } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { BulwarkMark } from "@/components/bulwark-mark";
import { UserMenu, type Me } from "@/components/user-menu";
import { ICON } from "@/components/icon";

const navLinks: { label: string; href: string; external?: boolean }[] = [
  { label: "Plugins", href: "/plugins" },
  { label: "Themes", href: "/themes" },
  { label: "Docs", href: "https://bulwarkmail.org/docs/extensions/introduction", external: true },
  { label: "bulwarkmail.org", href: "https://bulwarkmail.org", external: true },
];

/**
 * The nav sits on the field on every page, as on bulwarkmail.org. It is not
 * sticky and has no scroll state. Every control in it is 36px high.
 */
export function NavHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const { setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const dark = mounted && resolvedTheme === "dark";

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive) setMe(data);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [pathname]);

  // Close the phone menu when the route changes.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMobileOpen(false);
  }

  const current = (href: string) => (pathname === href || pathname.startsWith(href + "/") ? "page" : undefined);

  const renderLink = (link: (typeof navLinks)[number], onClick?: () => void) =>
    link.external ? (
      <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {link.label}
        <ArrowUpRight size={16} {...ICON} />
      </a>
    ) : (
      <Link key={link.href} href={link.href} aria-current={current(link.href)} onClick={onClick}>
        {link.label}
      </Link>
    );

  return (
    <header className="bw-field">
      <div className="bw-w">
        <div className="bw-nav-in">
          <Link href="/" className="bw-brandmark">
            <BulwarkMark size={24} color="currentColor" />
            <span>
              Bulwark <span className="dx-wordmark-sub">Extensions</span>
            </span>
          </Link>

          <nav className="bw-nav-links" aria-label="Main">
            {navLinks.map((l) => renderLink(l))}
          </nav>

          <div className="bw-nav-r">
            <button
              type="button"
              onClick={() => setTheme(dark ? "light" : "dark")}
              className="bw-iconbtn"
              aria-label="Switch between light and dark"
            >
              {dark ? <Sun size={16} {...ICON} /> : <Moon size={16} {...ICON} />}
            </button>
            <UserMenu me={me} loading={loading} onSignedOut={() => setMe(null)} />
            <Link href="/submit" className="bw-btn bw-btn-sm">
              Submit an extension
              <ArrowRight size={16} {...ICON} />
            </Link>
            <button
              type="button"
              className="bw-iconbtn bw-nav-phone"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? "Close the menu" : "Open the menu"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X size={20} {...ICON} /> : <Menu size={20} {...ICON} />}
            </button>
          </div>
        </div>

        {mobileOpen ? (
          <nav className="bw-nav-menu bw-nav-phone" aria-label="Main">
            {navLinks.map((l) => renderLink(l, () => setMobileOpen(false)))}
            <Link href="/search" onClick={() => setMobileOpen(false)}>
              Search
            </Link>
            {!loading && !me?.author ? (
              <a href="/api/v1/auth/github">
                <Github size={16} {...ICON} style={{ display: "inline", verticalAlign: "-2px", marginRight: 8 }} />
                Sign in with GitHub
              </a>
            ) : null}
            <Link href="/submit" className="bw-btn" onClick={() => setMobileOpen(false)}>
              Submit an extension
              <ArrowRight size={16} {...ICON} />
            </Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
