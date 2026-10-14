import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { extensions, extensionVersions } from "@/lib/db/schema";
import { getStoredFile, MEDIA_PATH_RE } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";
import { trackServerEvent } from "@/lib/umami";

// Serves two things only:
//   media/...    images re-encoded by lib/images.ts (content-hashed names)
//   bundles/...  bundle zips of approved versions of listed extensions
// Anything an author uploaded as-is (the old icons/, banners/, screenshots/
// folders, SVGs) is never served.
const SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

async function bundleIsPublic(relativePath: string): Promise<boolean> {
  const [row] = await db
    .select({ review: extensionVersions.reviewStatus, status: extensions.status })
    .from(extensionVersions)
    .innerJoin(extensions, eq(extensions.id, extensionVersions.extensionId))
    .where(eq(extensionVersions.bundlePath, relativePath))
    .limit(1);
  return !!row && row.review === "approved" && row.status === "approved";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const relativePath = pathSegments.join("/");

    let contentType: string;
    let cacheControl: string;
    if (MEDIA_PATH_RE.test(relativePath)) {
      contentType = relativePath.endsWith(".png") ? "image/png" : "image/webp";
      cacheControl = "public, max-age=31536000, immutable";
    } else if (/^bundles\/[^/]+\/[^/]+\/[^/]+\.zip$/.test(relativePath) && (await bundleIsPublic(relativePath))) {
      contentType = "application/zip";
      cacheControl = "public, max-age=86400";
    } else {
      return errorResponse("File not found", 404);
    }

    const file = await getStoredFile(relativePath);
    if (!file) {
      return errorResponse("File not found", 404);
    }

    if (contentType === "application/zip") {
      trackServerEvent(
        "extension-download",
        `/files/${relativePath}`,
        { bytes: file.length },
        request,
      );
    }

    return new Response(new Uint8Array(file), {
      headers: {
        ...SAFE_HEADERS,
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "Content-Length": file.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return errorResponse("Internal server error", 500);
  }
}
