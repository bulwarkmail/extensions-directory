"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Github, LogOut, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminInfo {
  id: string;
  githubLogin: string;
  role: "reviewer" | "admin" | "super_admin";
}

const navItems = [
  { label: "Dashboard", href: "/admin" },
  { label: "Submissions", href: "/admin/submissions" },
  { label: "Extensions", href: "/admin/extensions" },
  { label: "Authors", href: "/admin/authors" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    fetch("/api/v1/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.admin) {
          setAdmin(data.admin);
          setAuthed(true);
        } else {
          setAuthed(false);
        }
      })
      .catch(() => setAuthed(false));
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }

  if (authed === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground text-[13px]">
        Verifying access…
      </div>
    );
  }

  if (authed === false) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary mb-4">
          <ShieldAlert className="w-6 h-6" />
        </span>
        <h1
          className="text-2xl font-bold text-foreground tracking-tight"
          style={{ fontFamily: "var(--font-exo2)" }}
        >
          Admin access required
        </h1>
        <p className="mt-2 text-[14px] text-muted-foreground max-w-sm">
          You must be signed in as a directory admin to access this page.
        </p>
        <div className="mt-5 flex flex-col sm:flex-row items-center gap-3">
          <a
            href="/api/v1/auth/github"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-foreground text-background font-medium text-sm hover:bg-foreground/90 transition-colors"
          >
            <Github className="w-4 h-4" />
            Sign in with GitHub
          </a>
          <Link
            href="/"
            className="inline-flex items-center px-5 py-2.5 rounded-md border border-border bg-card text-foreground font-medium text-sm hover:bg-muted/50 hover:border-primary/30 transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <h1
            className="text-2xl font-bold text-foreground tracking-tight"
            style={{ fontFamily: "var(--font-exo2)" }}
          >
            Admin
          </h1>
          {admin && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider">
              {admin.role === "super_admin" ? "Super Admin" : admin.role}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {admin && (
            <span className="text-[12px] text-muted-foreground">
              @{admin.githubLogin}
            </span>
          )}
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted/50 transition-colors disabled:opacity-60"
          >
            <LogOut className="w-3.5 h-3.5" />
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </div>
      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        <nav className="md:w-48 shrink-0 flex md:block overflow-x-auto md:overflow-visible gap-1 md:gap-0 md:space-y-1 pb-1 md:pb-0">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "block rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                pathname === item.href
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
