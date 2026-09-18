import Link from "next/link";
import { Download, Palette, Puzzle, Star, CheckCircle2 } from "lucide-react";
import { formatDownloads } from "@/lib/utils";

const SANS = "var(--font-exo2), system-ui, sans-serif";
const SERIF = "var(--font-source-serif), 'Source Serif 4', Georgia, serif";
const MONO = "var(--font-jetbrains), ui-monospace, monospace";

interface ExtensionCardProps {
  slug: string;
  name: string;
  type: "plugin" | "theme";
  description: string;
  iconPath: string | null;
  author: {
    githubLogin: string;
    displayName: string;
    verified: boolean | null;
  } | null;
  totalDownloads: number | null;
  featured: boolean | null;
  tags: string[] | null;
  permissions: string[] | null;
  license: string;
}

export function ExtensionCard({
  slug,
  name,
  type,
  description,
  iconPath,
  author,
  totalDownloads,
  featured,
  tags,
}: ExtensionCardProps) {
  const Icon = type === "plugin" ? Puzzle : Palette;

  return (
    <Link
      href={`/extension/${slug}`}
      className="group relative flex flex-col bg-background p-5 border border-[color:var(--rule)] hover:border-foreground/40 transition-colors duration-200"
    >
      {featured && (
        <span
          className="absolute -top-px right-4 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{
            background: "var(--rasp)",
            color: "#fff",
            fontFamily: MONO,
          }}
        >
          <Star className="w-2.5 h-2.5 fill-current" />
          Featured
        </span>
      )}
      <div className="flex items-start gap-3.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-[color:var(--rule)] bg-[color:var(--alt-section)] text-foreground/70">
          {iconPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/v1/files/${iconPath}`}
              alt={name}
              className="h-12 w-12 object-cover"
            />
          ) : (
            <Icon className="w-5 h-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3
              className="truncate text-foreground group-hover:text-[color:var(--rasp)] transition-colors"
              style={{
                fontFamily: SANS,
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              {name}
            </h3>
            {author?.verified && (
              <CheckCircle2
                className="w-3.5 h-3.5 text-[color:var(--rasp)] shrink-0"
                aria-label="Verified author"
              />
            )}
          </div>
          {author && (
            <p
              className="mt-0.5 truncate text-foreground/65"
              style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 13 }}
            >
              by {author.displayName}
            </p>
          )}
        </div>
        <span
          className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-foreground/55"
          style={{ fontFamily: MONO, fontWeight: 500 }}
        >
          {type}
        </span>
      </div>
      <p
        className="mt-3 line-clamp-2 text-foreground/70"
        style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.5 }}
      >
        {description}
      </p>
      <div className="mt-auto flex items-center justify-between pt-4 gap-2">
        <div className="flex flex-wrap gap-1 min-w-0">
          {tags?.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="inline-flex px-1.5 py-0.5 text-[10px] tracking-wide truncate text-foreground/65"
              style={{
                fontFamily: MONO,
                background: "var(--alt-section)",
                border: "1px solid var(--rule)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
        <span
          className="inline-flex items-center gap-1 text-foreground/60 shrink-0"
          style={{ fontFamily: MONO, fontSize: 11 }}
        >
          <Download className="w-3 h-3" />
          {formatDownloads(totalDownloads ?? 0)}
        </span>
      </div>
    </Link>
  );
}
