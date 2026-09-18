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

    return jsonResponse({
      data: {
        markdown: extension.longDescription || extension.description,
      },
    });
  } catch (error) {
    console.error("Error fetching readme:", error);
    return errorResponse("Internal server error", 500);
  }
}
