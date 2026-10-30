import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { ExtIcon } from "@/components/ext-icon";
import { ICON } from "@/components/icon";

export interface ExtensionRow {
  slug: string;
  name: string;
  iconPath: string | null;
  author: { displayName: string; verified: boolean | null } | null;
  latestVersion?: string | null;
}

/**
 * A short ruled list of extensions: icon, name, author, and one fact on the
 * right (downloads, or when it was updated). Each row is one link. Denser
 * than the tiles, for the home page's second-tier lists.
 */
export function ExtensionRows<T extends ExtensionRow>({ rows, fact }: { rows: T[]; fact: (row: T) => string }) {
  return (
    <ol className="dx-list">
      {rows.map((r) => (
        <li key={r.slug}>
          <Link href={`/extension/${r.slug}`} className="dx-list-row">
            <ExtIcon name={r.name} iconPath={r.iconPath} size="sm" />
            <span className="dx-list-name">
              <span className="dx-list-title">{r.name}</span>
              {r.author ? (
                <span className="dx-by">
                  {r.author.displayName}
                  {r.author.verified ? (
                    <span title="Verified author">
                      <BadgeCheck size={14} {...ICON} />
                      <span className="sr-only">, verified author</span>
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>
            <span className="dx-list-fact">{fact(r)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
