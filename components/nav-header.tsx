"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, Moon, Search, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { BulwarkMark } from "@/components/bulwark-mark";
import { UserMenu } from "@/components/user-menu";

const navLinks: { label: string; href: string; external?: boolean }[] = [
  { label: "Plugins", href: "/plugins" },
  { label: "Themes", href: "/themes" },
  { label: "Submit", href: "/submit" },
  {
    label: "Docs",
    href: "https://bulwarkmail.org/docs/extensions/introduction",
    external: true,
  },
];

export function NavHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors duration-200",
        scrolled
          ? "bg-background/85 supports-[backdrop-filter]:backdrop-blur-xl border-b border-[color:var(--rule)]"
          : "bg-transparent border-b border-transparent"
      )}
    >
      <div className="px-5 sm:px-8 lg:px-14">
        <div className="mx-auto max-w-[1440px] grid grid-cols-[auto_1fr_auto] items-stretch">
          {/* Cell 1 — mark + wordmark */}
          <Link
            href="/"
            className="flex items-center gap-3 pr-5 sm:pr-8 lg:pr-14 py-5 border-r border-[color:var(--rule)]"
          >
            <BulwarkMark size={26} color="var(--rasp)" />
            <span
              className="font-extrabold tracking-tight text-[19px] leading-none"
              style={{ fontFamily: "var(--font-exo2)" }}
            >
              Bulwark
              <span className="ml-1.5 font-medium text-foreground/65">
                Extensions
              </span>
            </span>
          </Link>

          {/* Cell 2 — primary nav */}
          <nav className="hidden md:flex items-center gap-7 px-7">
            {navLinks.map((link) => {
              const active = link.external
                ? false
                : link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              const className = cn(
                "text-[14px] font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-foreground/70 hover:text-[color:var(--rasp)]"
              );
              return link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  className={className}
                  style={{ fontFamily: "var(--font-exo2)" }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className={className}
                  style={{ fontFamily: "var(--font-exo2)" }}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Cell 3 — actions */}
          <div className="flex items-center justify-end gap-3 pl-5 sm:pl-8 lg:pl-14 border-l border-[color:var(--rule)]">
            <Link
              href="/search"
              className="hidden md:inline-flex p-2 text-foreground/70 hover:text-foreground transition-colors"
              aria-label="Search extensions"
            >
              <Search className="w-4 h-4" />
            </Link>
            <button
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="hidden md:inline-flex p-2 text-foreground/70 hover:text-foreground transition-colors"
              aria-label="Toggle theme"
            >
              {mounted && resolvedTheme === "dark" ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
            <Link
              href="/submit"
              className="hidden md:inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold bg-[color:var(--rasp)] text-white hover:bg-[#c12649] transition-colors"
              style={{ fontFamily: "var(--font-exo2)" }}
            >
              Submit
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <div className="hidden md:block">
              <UserMenu />
            </div>
            <button
              className="md:hidden p-2 text-foreground/80"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen ? (
        <div className="md:hidden bg-background border-t border-[color:var(--rule)]">
          <div className="px-5 py-4 flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="px-2 py-2.5 text-sm text-foreground/85 hover:text-[color:var(--rasp)]"
                style={{ fontFamily: "var(--font-exo2)" }}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/search"
              onClick={() => setMobileOpen(false)}
              className="px-2 py-2.5 text-sm text-foreground/85 hover:text-[color:var(--rasp)]"
              style={{ fontFamily: "var(--font-exo2)" }}
            >
              Search
            </Link>
            <div className="h-px bg-[color:var(--rule)] my-2" />
            <div className="flex items-center justify-between gap-3 px-2 py-2">
              <button
                onClick={() => {
                  setTheme(resolvedTheme === "dark" ? "light" : "dark");
                  setMobileOpen(false);
                }}
                className="inline-flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground"
                aria-label="Toggle theme"
              >
                {mounted && resolvedTheme === "dark" ? (
                  <>
                    <Sun className="w-4 h-4" /> Light
                  </>
                ) : (
                  <>
                    <Moon className="w-4 h-4" /> Dark
                  </>
                )}
              </button>
              <div className="flex items-center gap-2">
                <Link
                  href="/submit"
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[color:var(--rasp)] text-white"
                  style={{ fontFamily: "var(--font-exo2)" }}
                >
                  Submit
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <UserMenu compact />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
