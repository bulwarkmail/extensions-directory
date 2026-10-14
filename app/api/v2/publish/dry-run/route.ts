import { handle } from "@/lib/http";
import { handlePublish } from "@/lib/publishing/handler";

// The full build and checks, without creating anything reviewable.
export const POST = handle(async (request: Request) => handlePublish(request, true));
