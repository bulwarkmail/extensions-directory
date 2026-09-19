"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Github } from "lucide-react";
import { ICON } from "@/components/icon";

interface AdminInfo {
  id: string;
  githubLogin: string;
  role: "reviewer" | "admin" | "super_admin";
}

const ROLE_LABEL: Record<AdminInfo["role"], string> = {
  reviewer: "reviewer",
  admin: "admin",
  super_admin: "super admin",
};

const navItems = [
  { label: "Overview", href: "/admin" },
  { label: "Submissions", href: "/admin/submissions" },
  { label: "Extensions", href: "/admin/extensions" },
  { label: "Authors", href: "/admin/authors" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
      <div className="bw-w">
        <p className="dx-msg bw-help" aria-live="polite">
          Checking your access…
        </p>
      </div>
    );
  }

  if (authed === false) {
    return (
      <div className="bw-w">
        <div className="dx-msg">
          <h1 className="bw-h2">Admin access required.</h1>
          <p>Sign in with the GitHub account of a directory admin to open this page.</p>
          <div className="bw-btns">
            <a href="/api/v1/auth/github" className="bw-btn">
              <Github size={16} {...ICON} />
              Sign in with GitHub
            </a>
            <Link href="/" className="bw-btn bw-btn-ghost">
              Back to the directory
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bw-w dx-work">
      <div className="dx-admin">
        <aside>
          {admin ? (
            <p className="dx-admin-who">
              Signed in as @{admin.githubLogin}, {ROLE_LABEL[admin.role]}.{" "}
              <button type="button" className="dx-textbtn" style={{ fontSize: "inherit" }} onClick={signOut} disabled={signingOut}>
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </p>
          ) : null}
          <nav aria-label="Admin">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="bw-side-item"
                aria-current={pathname === item.href ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div style={{ minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
