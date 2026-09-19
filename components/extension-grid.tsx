import { ExtensionCard, type ExtensionCardProps } from "./extension-card";

export interface ExtensionGridProps {
  extensions: ExtensionCardProps[];
  /** A plain sentence saying there is nothing here. */
  emptyTitle?: string;
  /** One sentence on what to try next. */
  emptyMessage?: string;
  /** Buttons or links under the empty message. */
  emptyActions?: React.ReactNode;
}

/** Extension tiles in three columns that share their edges. */
export function ExtensionGrid({ extensions, emptyTitle, emptyMessage, emptyActions }: ExtensionGridProps) {
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
        <ExtensionCard key={ext.slug} {...ext} />
      ))}
    </div>
  );
}
