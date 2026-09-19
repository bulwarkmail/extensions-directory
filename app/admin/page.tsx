"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Download, Palette, Puzzle, Users } from "lucide-react";
import { ICON } from "@/components/icon";

interface Stats {
  extensions: number;
  plugins: number;
  themes: number;
  authors: number;
  totalDownloads: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState<number | null>(null);

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

  const n = (v: number | undefined) => (v === undefined ? "…" : v.toLocaleString());

  return (
    <div>
      <div className="dx-work-head" style={{ marginBottom: 32 }}>
        <div>
          <h1 className="bw-h2">Overview</h1>
          <p>What the directory holds today, and what is waiting for a reviewer.</p>
        </div>
      </div>

      <div className="bw-note" style={{ marginBottom: 48 }}>
        <p>
          <b>
            {pending === null
              ? "Counting submissions…"
              : pending === 0
                ? "No submissions are waiting."
                : `${pending} ${pending === 1 ? "submission is" : "submissions are"} waiting for review.`}
          </b>{" "}
          <Link href="/admin/submissions" className="bw-tlink">
            Open the queue
            <ArrowRight size={16} {...ICON} />
          </Link>
        </p>
      </div>

      <div className="bw-facts">
        <div>
          <Puzzle size={24} {...ICON} />
          <h2 className="bw-h3">{n(stats?.plugins)} plugins</h2>
          <p>Of {n(stats?.extensions)} published extensions.</p>
        </div>
        <div>
          <Palette size={24} {...ICON} />
          <h2 className="bw-h3">{n(stats?.themes)} themes</h2>
          <p>CSS only, no permissions.</p>
        </div>
        <div>
          <Users size={24} {...ICON} />
          <h2 className="bw-h3">{n(stats?.authors)} authors</h2>
          <p>Signed in with GitHub.</p>
        </div>
        <div>
          <Download size={24} {...ICON} />
          <h2 className="bw-h3">{n(stats?.totalDownloads)} downloads</h2>
          <p>Across every version.</p>
        </div>
      </div>
    </div>
  );
}
