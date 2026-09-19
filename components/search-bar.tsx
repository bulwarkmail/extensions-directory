"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { ALLOWED_TAGS } from "@/lib/utils";
import { ICON } from "@/components/icon";

const TAG_LABELS: Record<string, string> = {
  "developer-tools": "Developer tools",
};
const tagLabel = (t: string) => TAG_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1);

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "updated", label: "Recently updated" },
  { value: "downloads", label: "Most downloaded" },
  { value: "name", label: "Name" },
];

/** The search form under the home page field: an input and a Search button. */
export function SearchBar({ placeholder = "Search plugins and themes" }: { placeholder?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  return (
    <form
      role="search"
      className="dx-searchform"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = query.trim();
        if (trimmed) router.push(`/search?q=${encodeURIComponent(trimmed)}`);
      }}
    >
      <div className="dx-search">
        <Search size={16} {...ICON} />
        <label htmlFor="home-search" className="sr-only">
          {placeholder}
        </label>
        <input
          id="home-search"
          type="search"
          className="bw-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
        />
      </div>
      <button type="submit" className="bw-btn">
        Search
      </button>
    </form>
  );
}

export type BrowseKind = "plugins" | "themes" | "search";

/**
 * The toolbar under the field on /plugins, /themes and /search: the type as a
 * segmented control, then one GET form with the search input and sort and
 * tag as native selects. Changing a select does not navigate on its own (a
 * change of context on input fails WCAG 3.2.2 for keyboard users); Enter in
 * the search field or "Show results" applies everything and returns to
 * page 1. The form also works without JavaScript.
 */
export function BrowseToolbar({
  kind,
  q = "",
  sort = "newest",
  tag = "",
  type = "",
}: {
  kind: BrowseKind;
  q?: string;
  sort?: string;
  tag?: string;
  type?: string;
}) {
  const base = kind === "search" ? "/search" : `/${kind}`;

  const href = (path: string, changes: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string> = { q, sort, tag, type, ...changes };
    if (path !== "/search") delete merged.type;
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `${path}?${s}` : path;
  };

  const types =
    kind === "search"
      ? [
          { label: "All", to: href("/search", { type: "" }), on: !type },
          { label: "Plugins", to: href("/search", { type: "plugin" }), on: type === "plugin" },
          { label: "Themes", to: href("/search", { type: "theme" }), on: type === "theme" },
        ]
      : [
          { label: "Plugins", to: href("/plugins", {}), on: kind === "plugins" },
          { label: "Themes", to: href("/themes", {}), on: kind === "themes" },
        ];

  const noun = kind === "plugins" ? "plugins" : kind === "themes" ? "themes" : "plugins and themes";

  return (
    <div className="dx-toolbar">
      <nav className="bw-switch" aria-label="Type">
        {types.map((t) => (
          <Link key={t.label} href={t.to} className="bw-switch-option" aria-current={t.on ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      <form role="search" method="get" action={base} className="dx-toolbar-form">
        {kind === "search" && type ? <input type="hidden" name="type" value={type} /> : null}
        <div className="dx-search">
          <Search size={16} {...ICON} />
          <label htmlFor={`search-${kind}`} className="sr-only">
            Search {noun}
          </label>
          <input
            id={`search-${kind}`}
            name="q"
            type="search"
            className="bw-input"
            defaultValue={q}
            placeholder={`Search ${noun}`}
            autoFocus={kind === "search" && !q}
          />
        </div>
        <label htmlFor={`sort-${kind}`} className="sr-only">
          Sort
        </label>
        <select id={`sort-${kind}`} name="sort" className="bw-input" defaultValue={sort}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <label htmlFor={`tag-${kind}`} className="sr-only">
          Tag
        </label>
        <select id={`tag-${kind}`} name="tag" className="bw-input" defaultValue={tag}>
          <option value="">All tags</option>
          {ALLOWED_TAGS.map((t) => (
            <option key={t} value={t}>
              {tagLabel(t)}
            </option>
          ))}
          {tag && !(ALLOWED_TAGS as readonly string[]).includes(tag) ? <option value={tag}>{tagLabel(tag)}</option> : null}
        </select>
        <button type="submit" className="bw-btn bw-btn-ghost">
          Show results
        </button>
      </form>
    </div>
  );
}
