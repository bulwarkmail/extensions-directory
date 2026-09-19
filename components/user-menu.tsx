"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Github, LayoutDashboard, LogOut, Shield, User } from "lucide-react";
import { ICON } from "@/components/icon";

export interface Me {
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

const ROLE_LABEL: Record<NonNullable<Me["admin"]>["role"], string> = {
  reviewer: "Reviewer",
  admin: "Admin",
  super_admin: "Super admin",
};

/**
 * The account control in the nav. Signed out it is a "Sign in" button;
 * signed in it is a 36px square with the author's initial that opens a
 * menu. The menu is rendered into <body> so it sits on the page ground with
 * page tokens, not on the field. Keyboard: Enter, Space or ArrowDown open
 * it on the first item, ArrowUp on the last; arrows, Home and End move;
 * Escape and Tab close it and Escape returns focus to the button.
 */
export function UserMenu({ me, loading, onSignedOut }: { me: Me | null; loading: boolean; onSignedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const menuId = useId();

  const place = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  // Move focus into the menu once it has been placed and rendered.
  const placed = open && pos !== null;
  useEffect(() => {
    if (!placed) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (items && items.length) (focusOnOpen.current === "last" ? items[items.length - 1] : items[0]).focus();
  }, [placed]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [open]);

  // Close when the route changes.
  const [openPath, setOpenPath] = useState(pathname);
  if (openPath !== pathname) {
    setOpenPath(pathname);
    setOpen(false);
  }

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusOnOpen.current = e.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close(false);
  };

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      onSignedOut();
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
    // Holds the place of the account control without a pulsing skeleton.
    return <span className="bw-iconbtn bw-nav-desk" aria-hidden style={{ visibility: "hidden" }} />;
  }

  if (!me?.author) {
    return (
      <a href="/api/v1/auth/github" className="bw-btn bw-btn-ghost bw-btn-sm">
        <Github size={16} {...ICON} />
        Sign in
      </a>
    );
  }

  const { author, admin } = me;
  const initial = (author.displayName || author.githubLogin).charAt(0).toUpperCase();

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="bw-iconbtn dx-nav-account"
        onClick={() => {
          focusOnOpen.current = "first";
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKey}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${author.displayName}`}
      >
        {initial}
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="dx-menu"
              role="menu"
              aria-label="Account"
              style={{ top: pos.top, right: pos.right }}
              onKeyDown={onMenuKey}
            >
              <div className="dx-menu-who">
                {author.displayName}
                <small>@{author.githubLogin}</small>
              </div>
              <Link href="/dashboard" className="dx-menu-item" role="menuitem" onClick={() => setOpen(false)}>
                <LayoutDashboard size={16} {...ICON} />
                Dashboard
              </Link>
              <Link href={`/author/${author.githubLogin}`} className="dx-menu-item" role="menuitem" onClick={() => setOpen(false)}>
                <User size={16} {...ICON} />
                Your public page
              </Link>
              {admin ? (
                <Link href="/admin" className="dx-menu-item" role="menuitem" onClick={() => setOpen(false)}>
                  <Shield size={16} {...ICON} />
                  Admin
                  <small>{ROLE_LABEL[admin.role]}</small>
                </Link>
              ) : null}
              <div className="dx-menu-sep" role="separator" />
              <button type="button" className="dx-menu-item" role="menuitem" onClick={signOut} disabled={signingOut}>
                <LogOut size={16} {...ICON} />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
