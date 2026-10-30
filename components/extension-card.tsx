import Link from "next/link";
import { BadgeCheck, Star } from "lucide-react";
import { formatDownloads } from "@/lib/utils";
import { ExtIcon, formatDownloadCount, formatTypeLabel } from "@/components/ext-icon";
import { ICON } from "@/components/icon";
import { InstallButton } from "@/components/install-button";

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
 * A shared-edge tile: icon beside the name and author, two lines of
 * description, then a footer with the type, downloads and "Featured" and a
 * quiet Install button. The name is the tile's link and stretches over the
 * whole tile, so the tile opens on a click anywhere while Install stays a
 * separate control. The footer is in the flow, so a long footer wraps
 * instead of running into the description.
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
  headingLevel = 3,
}: ExtensionCardProps & { headingLevel?: 2 | 3 }) {
  const downloads = totalDownloads ?? 0;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="bw-tile dx-card">
      <div className="dx-card-head">
        <ExtIcon name={name} iconPath={iconPath} />
        <div className="dx-card-name">
          <Heading className="bw-tile-title">
            <Link href={`/extension/${slug}`} className="dx-card-link">
              {name}
            </Link>
          </Heading>
          {author ? (
            <span className="dx-by">
              {author.displayName}
              {author.verified ? (
                <span title="Verified author">
                  <BadgeCheck size={14} {...ICON} />
                  <span className="sr-only">, verified author</span>
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
      <p className="bw-tile-text">{description}</p>
      <div className="dx-card-foot">
        <span className="dx-meta">
          <span>{formatTypeLabel(type, pluginType)}</span>
          <span>{formatDownloadCount(downloads, formatDownloads(downloads))}</span>
          {featured ? (
            <span className="dx-feat">
              <Star size={14} {...ICON} />
              Featured
            </span>
          ) : null}
        </span>
        <InstallButton slug={slug} small ghost label="Install" className="dx-card-install" ariaLabel={`Install ${name} on your Bulwark`} />
      </div>
    </div>
  );
}
