import { Inbox } from "lucide-react";
import { ExtensionCard } from "./extension-card";

const SANS = "var(--font-exo2), system-ui, sans-serif";
const SERIF = "var(--font-source-serif), 'Source Serif 4', Georgia, serif";

interface Extension {
  slug: string;
  name: string;
  type: "plugin" | "theme";
  description: string;
  iconPath: string | null;
  totalDownloads: number | null;
  featured: boolean | null;
  tags: string[] | null;
  permissions: string[] | null;
  license: string;
  author: {
    githubLogin: string;
    displayName: string;
    verified: boolean | null;
  } | null;
}

export interface ExtensionGridProps {
  extensions: Extension[];
  emptyTitle?: string;
  emptyMessage?: string;
}

export function ExtensionGrid({
  extensions,
  emptyTitle,
  emptyMessage = "No extensions found.",
}: ExtensionGridProps) {
  if (extensions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-[color:var(--rule)] bg-[color:var(--alt-section)]">
        <span className="inline-flex h-12 w-12 items-center justify-center border border-[color:var(--rule)] text-foreground/60 mb-4">
          <Inbox className="w-5 h-5" />
        </span>
        {emptyTitle && (
          <p
            className="text-foreground"
            style={{ fontFamily: SANS, fontWeight: 700, fontSize: 16 }}
          >
            {emptyTitle}
          </p>
        )}
        <p
          className="mt-1 text-foreground/65"
          style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 14 }}
        >
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {extensions.map((ext) => (
        <ExtensionCard key={ext.slug} {...ext} />
      ))}
    </div>
  );
}
