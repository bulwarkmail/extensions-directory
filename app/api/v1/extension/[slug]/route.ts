import { NextRequest } from "next/server";
import { jsonResponse, errorResponse } from "@/lib/utils";
import { appVersionOf, v1ExtensionDetail } from "@/lib/v1/catalog";
import { gone } from "@/lib/gone";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const data = v1ExtensionDetail(slug, appVersionOf(request.nextUrl.searchParams));
    if (!data) return errorResponse("Extension not found", 404);
    return jsonResponse({ data });
  } catch (error) {
    console.error("Error fetching extension:", error);
    return errorResponse("Internal server error", 500);
  }
}

// Editing moved to PATCH /api/v2/extensions/{slug} (session) and the dashboard.
export const PATCH = gone("PATCH /api/v2/extensions/{slug}");
