import { NextRequest } from "next/server";
import { getExtensionBySlug } from "@/lib/db/queries";
import { getStoredFile, MEDIA_PATH_RE } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const extension = await getExtensionBySlug(slug);

    // Only re-encoded icons (lib/images.ts) are served; an icon from before
    // the conversion has no media/ path and is treated as missing.
    if (
      !extension ||
      extension.status !== "approved" ||
      !extension.iconPath ||
      !MEDIA_PATH_RE.test(extension.iconPath)
    ) {
      return errorResponse("Icon not found", 404);
    }

    const file = await getStoredFile(extension.iconPath);
    if (!file) {
      return errorResponse("Icon not found", 404);
    }

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": extension.iconPath.endsWith(".png") ? "image/png" : "image/webp",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    console.error("Error fetching icon:", error);
    return errorResponse("Internal server error", 500);
  }
}
