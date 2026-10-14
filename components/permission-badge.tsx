import { Eye, LayoutPanelTop, TriangleAlert, type LucideIcon } from "lucide-react";
import { ICON } from "@/components/icon";
import { HIGH_RISK_PERMISSIONS, IMPLICIT, permissionText } from "@/lib/webmail-compat";

type Group = "act" | "read" | "ui";

// High-risk permissions (as the webmail's consent dialog marks them) are
// listed first, under the warning colour; then read access; then additions
// to the interface. Implicit permissions every plugin has are left out.
function groupOf(permission: string): Group {
  if (HIGH_RISK_PERMISSIONS.has(permission)) return "act";
  if (permission.startsWith("ui:")) return "ui";
  if (/(read|observe|lifecycle)$/.test(permission)) return "read";
  return "act";
}

const GROUPS: { key: Group; title: string; icon: LucideIcon }[] = [
  { key: "act", title: "Needs your trust: reads or sends mail, or reaches other servers", icon: TriangleAlert },
  { key: "read", title: "Can read", icon: Eye },
  { key: "ui", title: "Adds to the interface", icon: LayoutPanelTop },
];

/**
 * An extension's permissions, grouped by what they allow. Each group carries
 * an icon and words; the change-or-send group takes the warning colour, never
 * the brand colour and never the error colour.
 */
export function PermissionList({ permissions: all, isTheme = false }: { permissions: string[]; isTheme?: boolean }) {
  const permissions = (all ?? []).filter((p) => !IMPLICIT.includes(p));
  if (permissions.length === 0) {
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
                  {permissionText(p) ? (
                    <span title={permissionText(p)!.body}>{permissionText(p)!.title}</span>
                  ) : (
                    <span className="dx-perm-undoc">Not a permission this Bulwark version knows</span>
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
