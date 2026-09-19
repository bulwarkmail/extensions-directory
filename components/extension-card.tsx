import Link from "next/link";
import { ArrowRight, BadgeCheck, Star } from "lucide-react";
import { formatDownloads } from "@/lib/utils";
import { ExtIcon, formatDownloadCount, formatTypeLabel } from "@/components/ext-icon";
import { ICON } from "@/components/icon";

export interface ExtensionCardProps {
  slug: string;
  name: string;
  type: "plugin" | "theme";
  pluginType?: string | null;
  description: string;
  iconPath: string | null;
  author: {
    githubLogin: string;
    displayName: string;
    verified: boolean | null;
  } | null;
  totalDownloads: number | null;
  featured: boolean | null;
}

/**
 * A shared-edge tile: icon, name, author, one line of description, then the
 * type, the downloads and "Featured" in words, and the arrow bottom-right.
 * The whole tile is one link, so it holds no other link or button.
 */
export function ExtensionCard({
  slug,
  name,
  type,
  pluginType,
  description,
  iconPath,
  author,
  totalDownloads,
  featured,
}: ExtensionCardProps) {
  const downloads = totalDownloads ?? 0;
  return (
    <Link href={`/extension/${slug}`} className="bw-tile dx-card">
      <ExtIcon name={name} iconPath={iconPath} />
      <span className="bw-tile-title">{name}</span>
      {author ? (
        <span className="dx-by">
          {author.displayName}
          {author.verified ? (
            <span title="Verified author">
              <BadgeCheck size={16} {...ICON} />
              <span className="sr-only">, verified author</span>
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="bw-tile-text">{description}</span>
      <span className="dx-meta">
        <span>{formatTypeLabel(type, pluginType)}</span>
        <span>{formatDownloadCount(downloads, formatDownloads(downloads))}</span>
        {featured ? (
          <span className="dx-feat">
            <Star size={16} {...ICON} />
            Featured
          </span>
        ) : null}
      </span>
      <span className="bw-tile-arrow">
        <ArrowRight size={20} {...ICON} />
      </span>
    </Link>
  );
}
