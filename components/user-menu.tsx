"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Github, LayoutDashboard, LogOut, Shield, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface Me {
  author?: {
    id: string;
    githubLogin: string;
    displayName: string;
    avatarUrl: string | null;
  };
  admin?: {
    id: string;
    githubLogin: string;
    role: "reviewer" | "admin" | "super_admin";
  };
}

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
      setOpen(false);
      setSigningOut(false);
      if (pathname.startsWith("/admin")) {
        router.push("/");
      } else {
        router.refresh();
      }
    }
  }

  if (loading) {
    return (
      <div
        className={cn(
          "rounded-full bg-muted/60 animate-pulse",
          compact ? "h-7 w-7" : "h-8 w-8"
        )}
        aria-hidden
      />
    );
  }

  if (!me?.author) {
    return (
      <Link
        href="/api/v1/auth/github"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium transition-colors",
          compact
            ? "px-2.5 py-1 bg-muted/60 text-foreground hover:bg-muted"
            : "px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
      >
        <Github className="w-3.5 h-3.5" />
        Sign in
      </Link>
    );
  }

  const { author, admin } = me;
  const initial = (author.displayName || author.githubLogin).charAt(0).toUpperCase();
  const size = compact ? "h-7 w-7" : "h-8 w-8";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center justify-center rounded-full border border-border bg-card overflow-hidden transition-all hover:border-primary/40 hover:shadow-sm",
          size,
          open && "border-primary/60 shadow-sm"
        )}
        aria-label="Account menu"
        aria-expanded={open}
      >
        {author.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={author.avatarUrl}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="text-[11px] font-semibold text-foreground">{initial}</span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+0.5rem)] w-64 rounded-md border border-border bg-popover shadow-lg overflow-hidden z-50"
          role="menu"
        >
          <div className="px-3 py-3 border-b border-border/60 flex items-center gap-3">
            <div className={cn("inline-flex items-center justify-center rounded-full border border-border bg-card overflow-hidden shrink-0", "h-9 w-9")}>
              {author.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={author.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="text-[13px] font-semibold text-foreground">{initial}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-popover-foreground truncate">
                {author.displayName}
              </p>
              <p className="text-[11px] text-muted-foreground truncate font-mono">
                @{author.githubLogin}
              </p>
            </div>
          </div>

          <div className="py-1">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-[13px] text-popover-foreground hover:bg-muted/60 transition-colors"
              role="menuitem"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-muted-foreground" />
              Dashboard
            </Link>
            <Link
              href={`/author/${author.githubLogin}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-[13px] text-popover-foreground hover:bg-muted/60 transition-colors"
              role="menuitem"
            >
              <User className="w-3.5 h-3.5 text-muted-foreground" />
              Your profile
            </Link>
            {admin && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-[13px] text-popover-foreground hover:bg-muted/60 transition-colors"
                role="menuitem"
              >
                <Shield className="w-3.5 h-3.5 text-primary" />
                Admin panel
                <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-sm">
                  {admin.role === "super_admin" ? "Super" : admin.role}
                </span>
              </Link>
            )}
          </div>

          <div className="py-1 border-t border-border/60">
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-popover-foreground hover:bg-muted/60 transition-colors disabled:opacity-60"
              role="menuitem"
            >
              <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
