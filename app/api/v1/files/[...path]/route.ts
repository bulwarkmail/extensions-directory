import { NextRequest } from "next/server";
import { getStoredFile } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";
import { trackServerEvent } from "@/lib/umami";
import path from "path";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".zip": "application/zip",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const relativePath = pathSegments.join("/");

    // Only allow specific file extensions
    const ext = path.extname(relativePath).toLowerCase();
    if (!MIME_TYPES[ext]) {
      return errorResponse("File type not allowed", 403);
    }

    const file = await getStoredFile(relativePath);
    if (!file) {
      return errorResponse("File not found", 404);
    }

    if (ext === ".zip") {
      trackServerEvent(
        "extension-download",
        `/files/${relativePath}`,
        { bytes: file.length },
        request,
      );
    }

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": MIME_TYPES[ext],
        "Cache-Control": "public, max-age=86400",
        "Content-Length": file.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return errorResponse("Internal server error", 500);
  }
}
