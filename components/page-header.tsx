interface PageHeaderProps {
  title: string;
  /** One sentence under the title. Text on the field is full white, never muted. */
  description?: React.ReactNode;
  /** Buttons, shown under the sentence. */
  children?: React.ReactNode;
  /** The shorter header used on list and search pages. */
  compact?: boolean;
}

/**
 * The page header on the raspberry field, for catalogue, list, search and
 * author pages. Working pages (submit, dashboard, admin) keep only the nav on
 * the field and use a plain heading on white instead.
 */
export function PageHeader({ title, description, children, compact }: PageHeaderProps) {
  return (
    <section className="bw-field">
      <div className={`bw-w dx-hero${compact ? " dx-hero-sm" : ""}`}>
        <h1 className="bw-h1">{title}</h1>
        {description ? <p className="bw-lead">{description}</p> : null}
        {children ? <div className="bw-btns">{children}</div> : null}
      </div>
    </section>
  );
}
