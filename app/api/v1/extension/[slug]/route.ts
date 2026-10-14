import { NextRequest } from "next/server";
import { getExtensionBySlug } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";
import { v1Detail } from "@/lib/v1/serialize";
import { gone } from "@/lib/gone";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const extension = await getExtensionBySlug(slug);

    if (!extension) {
      return errorResponse("Extension not found", 404);
    }

    if (extension.status !== "approved") {
      return errorResponse("Extension not found", 404);
    }

    return jsonResponse({ data: v1Detail(extension) });
  } catch (error) {
    console.error("Error fetching extension:", error);
    return errorResponse("Internal server error", 500);
  }
}

// Editing moved to PATCH /api/v2/extensions/{slug} (session) and the dashboard.
export const PATCH = gone("PATCH /api/v2/extensions/{slug}");
