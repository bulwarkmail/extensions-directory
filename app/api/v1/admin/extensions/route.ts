import { gone } from "@/lib/gone";

export const GET = gone("/api/v2/admin/extensions");
export const PATCH = gone("/api/v2/admin/extensions/{slug}");
