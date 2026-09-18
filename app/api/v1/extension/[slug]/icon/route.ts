import { NextRequest } from "next/server";
import { getExtensionBySlug } from "@/lib/db/queries";
import { getStoredFile } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const extension = await getExtensionBySlug(slug);

    if (!extension || extension.status !== "approved" || !extension.iconPath) {
      return errorResponse("Icon not found", 404);
    }

    const file = await getStoredFile(extension.iconPath);
    if (!file) {
      return errorResponse("Icon not found", 404);
    }

    const contentType = extension.iconPath.endsWith(".svg")
      ? "image/svg+xml"
      : "image/png";

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error("Error fetching icon:", error);
    return errorResponse("Internal server error", 500);
  }
}
