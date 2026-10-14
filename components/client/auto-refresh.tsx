"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reloads the server data every few seconds while something is still running. */
export function AutoRefresh({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return active ? <p className="bw-help" aria-live="polite">The build is running; this page updates by itself.</p> : null;
}
