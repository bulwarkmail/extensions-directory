import { NextRequest } from "next/server";
import { getExtensionBySlug } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const extension = await getExtensionBySlug(slug);

    if (!extension || extension.status !== "approved") {
      return errorResponse("Extension not found", 404);
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
    return jsonResponse({
      data: extension.screenshots.map((s) => ({
        url: `${siteUrl}/api/v1/files/${s.path}`,
        altText: s.altText,
      })),
    });
  } catch (error) {
    console.error("Error fetching screenshots:", error);
    return errorResponse("Internal server error", 500);
  }
}
