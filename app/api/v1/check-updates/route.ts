import { NextRequest } from "next/server";
import { checkUpdates } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.extensions || !Array.isArray(body.extensions)) {
      return errorResponse("Invalid request: 'extensions' array required", 400);
    }

    for (const ext of body.extensions) {
      if (!ext.slug || !ext.version) {
        return errorResponse("Each extension must have 'slug' and 'version'", 400);
      }
    }

    const result = await checkUpdates(body.extensions);
    return jsonResponse({ data: result });
  } catch (error) {
    console.error("Error checking updates:", error);
    return errorResponse("Internal server error", 500);
  }
}
