import { type ClassValue, clsx } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}

export function formatDate(date: Date | string | null): string {
  if (!date) return "Unknown";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function timeAgo(date: Date | string | null): string {
  if (!date) return "Unknown";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 30) return formatDate(d);
  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHour > 0) return `${diffHour}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return "Just now";
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export const ALLOWED_TAGS = [
  "productivity",
  "security",
  "automation",
  "appearance",
  "integration",
  "communication",
  "developer-tools",
  "accessibility",
] as const;

export const PERMISSION_CATEGORIES: Record<string, string[]> = {
  Email: ["email:read", "email:write", "email:send"],
  Calendar: ["calendar:read", "calendar:write"],
  Contacts: ["contacts:read", "contacts:write"],
  Files: ["files:read", "files:write"],
  Identity: ["identity:read", "identity:write"],
  Filters: ["filters:read", "filters:write"],
  Tasks: ["tasks:read", "tasks:write"],
  Templates: ["templates:read", "templates:write"],
  "S/MIME": ["smime:read"],
  Vacation: ["vacation:read", "vacation:write"],
  Settings: ["settings:read"],
  Security: ["security:read"],
  UI: [
    "ui:toolbar",
    "ui:email-banner",
    "ui:email-footer",
    "ui:composer-toolbar",
    "ui:sidebar-widget",
    "ui:settings-section",
    "ui:context-menu",
    "ui:navigation-rail",
    "ui:keyboard",
  ],
  Auth: ["auth:observe"],
};

export const ALL_PERMISSIONS = Object.values(PERMISSION_CATEGORIES).flat();
