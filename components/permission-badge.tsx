import { PERMISSION_CATEGORIES } from "@/lib/utils";

interface PermissionBadgeProps {
  permission: string;
}

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  "email:read": "Access email data, detect opens",
  "email:write": "Modify/delete emails, manage tags",
  "email:send": "Send emails on your behalf",
  "calendar:read": "View calendar events",
  "calendar:write": "Create/modify calendar events",
  "contacts:read": "View contacts",
  "contacts:write": "Create/modify contacts",
  "files:read": "View files",
  "files:write": "Create/modify files",
  "identity:read": "View identity settings",
  "identity:write": "Modify identity settings",
  "filters:read": "View email filters",
  "filters:write": "Create/modify email filters",
  "tasks:read": "View tasks",
  "tasks:write": "Create/modify tasks",
  "templates:read": "View email templates",
  "templates:write": "Create/modify email templates",
  "smime:read": "View S/MIME certificates",
  "vacation:read": "View vacation responder",
  "vacation:write": "Modify vacation responder",
  "settings:read": "View application settings",
  "security:read": "View security settings",
  "ui:toolbar": "Add toolbar buttons",
  "ui:email-banner": "Display banners on emails",
  "ui:email-footer": "Add content to email footer",
  "ui:composer-toolbar": "Add composer toolbar buttons",
  "ui:sidebar-widget": "Add sidebar widgets",
  "ui:settings-section": "Add settings sections",
  "ui:context-menu": "Add context menu items",
  "ui:navigation-rail": "Add navigation items",
  "ui:keyboard": "Register keyboard shortcuts",
  "auth:observe": "Observe authentication events",
};

function getCategoryColor(permission: string): string {
  for (const [category, perms] of Object.entries(PERMISSION_CATEGORIES)) {
    if (perms.includes(permission)) {
      switch (category) {
        case "Email":
          return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
        case "Calendar":
          return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
        case "Contacts":
          return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400";
        case "UI":
          return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
        case "Security":
        case "S/MIME":
          return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
        default:
          return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300";
      }
    }
  }
  return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300";
}

export function PermissionBadge({ permission }: PermissionBadgeProps) {
  const description = PERMISSION_DESCRIPTIONS[permission];
  const colorClass = getCategoryColor(permission);

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex rounded-sm px-2 py-0.5 text-[11px] font-medium font-mono ${colorClass}`}
        title={description}
      >
        {permission}
      </span>
      {description && (
        <span className="text-[12px] text-muted-foreground">
          {description}
        </span>
      )}
    </div>
  );
}

export function PermissionList({ permissions }: { permissions: string[] }) {
  if (!permissions || permissions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No special permissions required
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {permissions.map((p) => (
        <PermissionBadge key={p} permission={p} />
      ))}
    </div>
  );
}
