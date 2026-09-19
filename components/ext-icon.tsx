/**
 * An extension's icon. The author's art is shown as they drew it, with no
 * frame around it. Without an icon the extension gets a plain square with
 * its initial in the text colour.
 */
export function ExtIcon({
  name,
  iconPath,
  size = "md",
}: {
  name: string;
  iconPath: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const suffix = size === "md" ? "" : ` dx-${iconPath ? "art" : "initial"}-${size}`;
  if (iconPath) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/v1/files/${iconPath}`} alt="" className={`dx-art${suffix}`} />
    );
  }
  return (
    <span className={`dx-initial${suffix}`} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

const PLUGIN_TYPE_LABELS: Record<string, string> = {
  hook: "Hook",
  "ui-extension": "UI extension",
  "sidebar-app": "Sidebar app",
};

export function formatTypeLabel(type: string, pluginType?: string | null): string {
  if (type === "theme") return "Theme";
  if (pluginType && PLUGIN_TYPE_LABELS[pluginType]) return PLUGIN_TYPE_LABELS[pluginType];
  return "Plugin";
}

export function formatDownloadCount(n: number, formatted: string): string {
  return `${formatted} ${n === 1 ? "download" : "downloads"}`;
}
