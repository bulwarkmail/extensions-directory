import { router } from "@/lib/api/router";
import { v2Routes } from "@/lib/api/v2";

// Every /api/v2 endpoint except /publish, /publish/dry-run and
// /submissions/{id}, which have their own route files. See lib/api/v2.ts.
const dispatch = router(v2Routes);

export const GET = dispatch("GET");
export const POST = dispatch("POST");
export const PATCH = dispatch("PATCH");
export const DELETE = dispatch("DELETE");
