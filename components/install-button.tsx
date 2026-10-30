import { Puzzle } from "lucide-react";
import { ICON } from "@/components/icon";
import { connectorHost, installUrl } from "@/lib/connector-link";

/**
 * "Install on your Bulwark": a link to the connector, which opens this
 * extension's marketplace page on whichever Bulwark the reader's browser
 * knows (lib/connector-link.ts). A plain anchor, so it works without
 * JavaScript and inside server components.
 */
export function InstallButton({
  slug,
  version,
  ghost,
  small,
  label,
  className,
  ariaLabel,
}: {
  slug: string;
  version?: string | null;
  ghost?: boolean;
  small?: boolean;
  label?: string;
  className?: string;
  /** For a short label repeated on a page ("Install" on every tile). */
  ariaLabel?: string;
}) {
  const classes = ["bw-btn", ghost ? "bw-btn-ghost" : "", small ? "bw-btn-sm" : "", className ?? ""].filter(Boolean).join(" ");
  const text = label ?? (version ? `Install version ${version}` : "Install on your Bulwark");
  return (
    <a
      className={classes}
      aria-label={ariaLabel}
      href={installUrl(slug, version)}
      title={`Opens the marketplace of your own Bulwark through ${connectorHost()}`}
    >
      {text}
      <Puzzle size={16} {...ICON} />
    </a>
  );
}

/** The one-line explanation under an Install button. */
export function InstallHelp({ className }: { className?: string }) {
  return (
    <p className={`bw-help${className ? ` ${className}` : ""}`}>
      Install opens the marketplace on your own Bulwark, through {connectorHost()}. Your server address stays in your
      browser.
    </p>
  );
}
