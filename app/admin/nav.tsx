"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { label: "Overview", href: "/admin" },
  { label: "Review queue", href: "/admin/submissions" },
  { label: "Text changes", href: "/admin/text-changes" },
  { label: "Reports", href: "/admin/reports" },
  { label: "Ratings", href: "/admin/ratings" },
  { label: "Extensions", href: "/admin/extensions" },
  { label: "Advisories", href: "/admin/advisories" },
  { label: "Authors", href: "/admin/authors", admin: true },
  { label: "API tokens", href: "/admin/tokens", admin: true },
  { label: "Audit log", href: "/admin/audit", admin: true },
];

export function AdminNav({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin">
      {items.filter((i) => admin || !i.admin).map((item) => (
        <Link key={item.href} href={item.href} className="bw-side-item"
          aria-current={pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href)) ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
