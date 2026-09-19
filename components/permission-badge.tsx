import { Eye, LayoutPanelTop, TriangleAlert, type LucideIcon } from "lucide-react";
import { ICON } from "@/components/icon";

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  "email:read": "Read email and detect when messages are opened",
  "email:write": "Change and delete email, and manage tags",
  "email:send": "Send email as you",
  "calendar:read": "Read calendar events",
  "calendar:write": "Create and change calendar events",
  "contacts:read": "Read contacts",
  "contacts:write": "Create and change contacts",
  "files:read": "Read files",
  "files:write": "Create and change files",
  "identity:read": "Read identity settings",
  "identity:write": "Change identity settings",
  "filters:read": "Read email filters",
  "filters:write": "Create and change email filters",
  "tasks:read": "Read tasks",
  "tasks:write": "Create and change tasks",
  "templates:read": "Read email templates",
  "templates:write": "Create and change email templates",
  "smime:read": "Read S/MIME certificates",
  "vacation:read": "Read the vacation responder",
  "vacation:write": "Change the vacation responder",
  "settings:read": "Read application settings",
  "security:read": "Read security settings",
  "ui:toolbar": "Add toolbar buttons",
  "ui:email-banner": "Show banners on messages",
  "ui:email-footer": "Add content below messages",
  "ui:composer-toolbar": "Add buttons to the composer",
  "ui:sidebar-widget": "Add sidebar widgets",
  "ui:settings-section": "Add a settings section",
  "ui:context-menu": "Add context menu items",
  "ui:navigation-rail": "Add navigation items",
  "ui:keyboard": "Register keyboard shortcuts",
  "auth:observe": "Observe sign-in and sign-out events",
};

type Group = "act" | "read" | "ui";

// The data has no risk levels, so the group follows from the permission's
// name: anything under ui: adds to the interface, anything that reads or
// observes is read access, and everything else can change things or send.
// Permissions the directory has no description for still land in a group.
function groupOf(permission: string): Group {
  if (permission.startsWith("ui:")) return "ui";
  if (/(read|observe|lifecycle)$/.test(permission)) return "read";
  return "act";
}

const GROUPS: { key: Group; title: string; icon: LucideIcon }[] = [
  { key: "act", title: "Can change things or send", icon: TriangleAlert },
  { key: "read", title: "Can read", icon: Eye },
  { key: "ui", title: "Adds to the interface", icon: LayoutPanelTop },
];

/**
 * An extension's permissions, grouped by what they allow. Each group carries
 * an icon and words; the change-or-send group takes the warning colour, never
 * the brand colour and never the error colour.
 */
export function PermissionList({ permissions, isTheme = false }: { permissions: string[]; isTheme?: boolean }) {
  if (!permissions || permissions.length === 0) {
    return (
      <p className="bw-help">
        {isTheme ? "No permissions. Themes change styles only." : "No special permissions."}
      </p>
    );
  }

  return (
    <div>
      {GROUPS.map(({ key, title, icon: Icon }) => {
        const list = permissions.filter((p) => groupOf(p) === key);
        if (list.length === 0) return null;
        return (
          <div key={key} className={`dx-perm-group dx-perm-${key}`}>
            <h3>
              <Icon size={16} {...ICON} />
              {title}
            </h3>
            <ul>
              {list.map((p) => (
                <li key={p}>
                  {PERMISSION_DESCRIPTIONS[p] ? (
                    <span>{PERMISSION_DESCRIPTIONS[p]}</span>
                  ) : (
                    <span className="dx-perm-undoc">No description in the directory yet</span>
                  )}
                  <code className="bw-icode">{p}</code>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
