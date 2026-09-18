"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Download,
  Inbox,
  Palette,
  Puzzle,
  Users,
} from "lucide-react";

interface Stats {
  extensions: number;
  plugins: number;
  themes: number;
  authors: number;
  totalDownloads: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    fetch("/api/v1/stats")
      .then((r) => r.json())
      .then((body) => setStats(body?.data ?? null))
      .catch(() => {});

    fetch("/api/v1/admin/submissions")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.submissions)) {
          setPending(data.submissions.length);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <h2 className="text-lg font-bold text-foreground">Dashboard</h2>
      <p className="text-[12px] text-muted-foreground mt-0.5">
        Snapshot of the directory.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          icon={<Puzzle className="w-3.5 h-3.5" />}
          label="Extensions"
          value={stats?.extensions ?? "—"}
        />
        <StatCard
          icon={<Puzzle className="w-3.5 h-3.5" />}
          label="Plugins"
          value={stats?.plugins ?? "—"}
        />
        <StatCard
          icon={<Palette className="w-3.5 h-3.5" />}
          label="Themes"
          value={stats?.themes ?? "—"}
        />
        <StatCard
          icon={<Users className="w-3.5 h-3.5" />}
          label="Authors"
          value={stats?.authors ?? "—"}
        />
        <StatCard
          icon={<Download className="w-3.5 h-3.5" />}
          label="Downloads"
          value={stats?.totalDownloads ?? "—"}
        />
      </div>

      <div className="mt-6">
        <Link
          href="/admin/submissions"
          className={`block rounded-md border p-4 transition-colors ${
            pending > 0
              ? "border-warning/40 bg-warning/5 hover:bg-warning/10"
              : "border-border bg-card hover:bg-muted/30"
          }`}
        >
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${
                pending > 0
                  ? "bg-warning/15 text-warning"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Inbox className="w-4 h-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-foreground">
                {pending > 0
                  ? `${pending} submission${pending === 1 ? "" : "s"} waiting for review`
                  : "No pending submissions"}
              </p>
              <p className="text-[12px] text-muted-foreground">
                Open the submissions queue to approve or reject.
              </p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-bold text-foreground tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
