import { NextRequest } from "next/server";
import { getExtensionBySlug, getVersion, recordDownload } from "@/lib/db/queries";
import { getStoredFile } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";
import crypto from "crypto";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; version: string }> }
) {
  try {
    const { slug, version: versionStr } = await params;
    const extension = await getExtensionBySlug(slug);

    if (!extension || extension.status !== "approved") {
      return errorResponse("Extension not found", 404);
    }

    const version = await getVersion(extension.id, versionStr);
    if (!version || version.reviewStatus !== "approved") {
      return errorResponse("Version not found", 404);
    }

    const file = await getStoredFile(version.bundlePath);
    if (!file) {
      return errorResponse("Bundle file not found", 404);
    }

    // Record download
    const ua = request.headers.get("user-agent");
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
    await recordDownload(extension.id, version.id, ua, ipHash);

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${slug}-${versionStr}.zip"`,
        "Content-Length": file.length.toString(),
        "X-Content-SHA256": version.bundleSha256,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error downloading bundle:", error);
    return errorResponse("Internal server error", 500);
  }
}
