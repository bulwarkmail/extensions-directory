import Link from "next/link";

const items = [
  { href: "/dashboard", label: "Extensions" },
  { href: "/dashboard/tokens", label: "API tokens" },
  { href: "/dashboard/settings", label: "Notifications" },
  { href: "/publishing", label: "How to publish" },
];

/** The dashboard's section links. */
export function DashboardNav({ current }: { current: string }) {
  return (
    <nav aria-label="Dashboard" className="dx-tabs">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="dx-tab" aria-current={current === i.href ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
