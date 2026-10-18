/**
 * Links that open an extension on the reader's own Bulwark.
 *
 * The directory cannot know where someone's Bulwark runs, so an "Install"
 * link does not point at a server. It names a destination on the Bulwark
 * Connector (connector.bulwarkmail.org, github.com/bulwarkmail/connector),
 * and the reader's browser resolves it to `<their Bulwark>/connector/...`
 * from a list it keeps in localStorage. The connector stores nothing about
 * the visitor and never sees where the link goes.
 *
 * The target is `admin_extension`: the marketplace page of the extension in
 * the Bulwark admin area, where an admin can install it. With `version`, that
 * version is offered instead of the newest one; a Bulwark older than the
 * version parameter ignores it and shows the newest.
 */

const CONNECTOR_URL = (process.env.NEXT_PUBLIC_CONNECTOR_URL || "https://connector.bulwarkmail.org").replace(/\/+$/, "");

export function connectorHost(): string {
  return CONNECTOR_URL.replace(/^https?:\/\//, "");
}

export function installUrl(slug: string, version?: string | null): string {
  const params = new URLSearchParams({ slug });
  if (version) params.set("version", version);
  return `${CONNECTOR_URL}/admin_extension?${params.toString()}`;
}

/**
 * A README badge for the extension: the connector serves a light and a dark
 * badge, and GitHub strips `prefers-color-scheme` from SVGs, so the snippet
 * uses `<picture>` to pick one.
 */
export function installBadgeMarkdown(slug: string): string {
  const href = installUrl(slug);
  return [
    `<a href="${href}">`,
    `  <picture>`,
    `    <source media="(prefers-color-scheme: dark)" srcset="${CONNECTOR_URL}/badges/admin_extension-dark.svg">`,
    `    <img alt="Install in Bulwark" src="${CONNECTOR_URL}/badges/admin_extension.svg">`,
    `  </picture>`,
    `</a>`,
  ].join("\n");
}
