import { NextRequest } from "next/server";
import { jsonResponse, errorResponse } from "@/lib/utils";
import { appVersionOf, v1CheckUpdates } from "@/lib/v1/catalog";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.extensions || !Array.isArray(body.extensions)) {
      return errorResponse("Invalid request: 'extensions' array required", 400);
    }
    if (body.extensions.length > 500) {
      return errorResponse("At most 500 extensions per request", 400);
    }
    for (const ext of body.extensions) {
      if (!ext.slug || !ext.version) {
        return errorResponse("Each extension must have 'slug' and 'version'", 400);
      }
    }

    return jsonResponse({ data: v1CheckUpdates(body.extensions, appVersionOf(body)) });
  } catch (error) {
    console.error("Error checking updates:", error);
    return errorResponse("Internal server error", 500);
  }
}
