import { gone } from "@/lib/gone";

export const GET = gone("/api/v2/admin/submissions");
export const POST = gone("/api/v2/admin/submissions/{id}/approve and /reject");
