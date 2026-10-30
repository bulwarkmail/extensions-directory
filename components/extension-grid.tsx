import { ExtensionCard, type ExtensionCardProps } from "./extension-card";

export interface ExtensionGridProps {
  extensions: ExtensionCardProps[];
  /** A plain sentence saying there is nothing here. */
  emptyTitle?: string;
  /** One sentence on what to try next. */
  emptyMessage?: string;
  /** Buttons or links under the empty message. */
  emptyActions?: React.ReactNode;
  /** 2 where the tiles sit right under the page's h1, 3 under a section's h2. */
  headingLevel?: 2 | 3;
}

/** Extension tiles in three columns that share their edges. */
export function ExtensionGrid({ extensions, emptyTitle, emptyMessage, emptyActions, headingLevel = 3 }: ExtensionGridProps) {
  if (extensions.length === 0) {
    return (
      <div className="dx-empty">
        {emptyTitle ? <h2 className="bw-h2">{emptyTitle}</h2> : null}
        {emptyMessage ? <p>{emptyMessage}</p> : null}
        {emptyActions ? <div className="bw-btns">{emptyActions}</div> : null}
      </div>
    );
  }

  return (
    <div className="bw-tiles bw-tiles-3">
      {extensions.map((ext) => (
        <ExtensionCard key={ext.slug} {...ext} headingLevel={headingLevel} />
      ))}
    </div>
  );
}
