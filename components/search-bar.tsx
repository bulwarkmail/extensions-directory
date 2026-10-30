"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";
import { ALLOWED_TAGS } from "@/lib/utils";
import { ICON } from "@/components/icon";

const TAG_LABELS: Record<string, string> = {
  "developer-tools": "Developer tools",
};
const tagLabel = (t: string) => TAG_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1);

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "updated", label: "Updated" },
  { value: "downloads", label: "Downloads" },
  { value: "name", label: "Name" },
];

/**
 * The search form: an input and a Search button. `onField` is the large one
 * in the home page header, a white input with an ink button on the field.
 */
export function SearchBar({ placeholder = "Search plugins and themes", onField = false }: { placeholder?: string; onField?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  return (
    <form
      role="search"
      className={`dx-searchform${onField ? " dx-searchform-field" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = query.trim();
        router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
      }}
    >
      <div className="dx-search">
        <Search size={18} {...ICON} />
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
 * The toolbar under the field on /plugins, /themes and /search. First row:
 * the type as a segmented control and the search field (Enter searches and
 * keeps the sort and tag). Second row: the tags as chips and the sort as a
 * segmented control. Tags and sort are links, so each choice applies at once
 * and the page never changes just because a control changed (WCAG 3.2.2).
 * Everything works without JavaScript.
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
    if (merged.sort === "newest") delete merged.sort;
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
  const tags = [...ALLOWED_TAGS, ...(tag && !(ALLOWED_TAGS as readonly string[]).includes(tag) ? [tag] : [])];

  return (
    <div className="dx-toolbar">
      <div className="dx-toolbar-row">
        <nav className="bw-switch" aria-label="Type">
          {types.map((t) => (
            <Link key={t.label} href={t.to} className="bw-switch-option" aria-current={t.on ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <form role="search" method="get" action={base} className="dx-search">
          {kind === "search" && type ? <input type="hidden" name="type" value={type} /> : null}
          {sort && sort !== "newest" ? <input type="hidden" name="sort" value={sort} /> : null}
          {tag ? <input type="hidden" name="tag" value={tag} /> : null}
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
          {q ? (
            <Link href={href(base, { q: "" })} className="dx-search-clear" aria-label="Clear the search">
              <X size={16} {...ICON} />
            </Link>
          ) : null}
        </form>
        <nav className="dx-sort" aria-label="Sort">
          <span className="dx-sort-label" aria-hidden="true">Sort</span>
          <span className="bw-switch">
            {SORTS.map((s) => (
              <Link
                key={s.value}
                href={href(base, { sort: s.value })}
                className="bw-switch-option"
                aria-current={(sort || "newest") === s.value ? "page" : undefined}
                aria-label={`Sort by ${s.label.toLowerCase()}`}
              >
                {s.label}
              </Link>
            ))}
          </span>
        </nav>
      </div>
      <div className="dx-toolbar-row">
        <nav className="dx-chips" aria-label="Tag">
          <Link href={href(base, { tag: "" })} aria-current={!tag ? "page" : undefined}>
            All
          </Link>
          {tags.map((t) => (
            <Link key={t} href={href(base, { tag: t })} aria-current={tag === t ? "page" : undefined}>
              {tagLabel(t)}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
