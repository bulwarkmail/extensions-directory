"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback } from "react";
import { Search } from "lucide-react";

const SANS = "var(--font-exo2), system-ui, sans-serif";
const MONO = "var(--font-jetbrains), ui-monospace, monospace";

interface SearchBarProps {
  defaultQuery?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchBar({
  defaultQuery = "",
  placeholder = "Search extensions...",
  autoFocus,
}: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultQuery);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (trimmed) {
        router.push(`/search?q=${encodeURIComponent(trimmed)}`);
      }
    },
    [query, router]
  );

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-xl">
      <div className="relative group">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/55 pointer-events-none transition-colors group-focus-within:text-[color:var(--rasp)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full border border-[color:var(--rule)] bg-background py-3 pl-11 pr-28 text-[14px] text-foreground placeholder:text-foreground/45 transition-all focus:border-foreground/60 focus:outline-none"
          style={{ fontFamily: SANS }}
        />
        <button
          type="submit"
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center px-3.5 py-1.5 text-[12px] font-semibold transition-colors hover:bg-[#c12649]"
          style={{
            background: "var(--rasp)",
            color: "#fff",
            fontFamily: SANS,
          }}
        >
          Search
        </button>
      </div>
    </form>
  );
}

export function SearchFilters({
  type,
  sort,
  tag,
}: {
  type?: string;
  sort?: string;
  tag?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  const selectClass =
    "border border-[color:var(--rule)] bg-background px-3 py-2 text-[13px] text-foreground transition-colors hover:border-foreground/60 focus:border-foreground/80 focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2" style={{ fontFamily: MONO }}>
      <select
        value={type || ""}
        onChange={(e) => updateFilter("type", e.target.value)}
        className={selectClass}
      >
        <option value="">All types</option>
        <option value="plugin">Plugins</option>
        <option value="theme">Themes</option>
      </select>

      <select
        value={sort || "newest"}
        onChange={(e) => updateFilter("sort", e.target.value)}
        className={selectClass}
      >
        <option value="newest">Newest</option>
        <option value="updated">Recently updated</option>
        <option value="downloads">Most downloads</option>
        <option value="name">Name</option>
      </select>

      <select
        value={tag || ""}
        onChange={(e) => updateFilter("tag", e.target.value)}
        className={selectClass}
      >
        <option value="">All tags</option>
        <option value="productivity">Productivity</option>
        <option value="security">Security</option>
        <option value="automation">Automation</option>
        <option value="appearance">Appearance</option>
        <option value="integration">Integration</option>
        <option value="communication">Communication</option>
        <option value="developer-tools">Developer tools</option>
        <option value="accessibility">Accessibility</option>
      </select>
    </div>
  );
}
