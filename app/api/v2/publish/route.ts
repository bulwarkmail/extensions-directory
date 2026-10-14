import { handle } from "@/lib/http";
import { handlePublish } from "@/lib/publishing/handler";

// Submit a version for review from CI. See docs/publishing.md.
export const POST = handle(async (request: Request) => handlePublish(request, false));
