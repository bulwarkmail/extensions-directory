import { NextRequest } from "next/server";
import { extensionBySlug, releasesOf } from "@/lib/catalog";
import { listedVersions } from "@/lib/v1/catalog";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const row = extensionBySlug(slug);
    if (!row || row.e.status !== "approved") {
      return errorResponse("Extension not found", 404);
    }
    const versions = listedVersions(releasesOf([row.e.id]).get(row.e.id) ?? []);
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
