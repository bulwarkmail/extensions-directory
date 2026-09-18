import { NextRequest } from "next/server";
import { getExtensionBySlug, getExtensionVersions } from "@/lib/db/queries";
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

    const versions = await getExtensionVersions(extension.id);

    return jsonResponse({
      data: versions.map((v) => ({
        version: v.version,
        changelog: v.changelog,
        bundleSize: v.bundleSize,
        bundleSha256: v.bundleSha256,
        permissions: v.permissions,
        minAppVersion: v.minAppVersion,
        publishedAt: v.publishedAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching versions:", error);
    return errorResponse("Internal server error", 500);
  }
}
