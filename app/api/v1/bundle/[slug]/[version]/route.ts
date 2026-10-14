import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { extensions, extensionVersions } from "@/lib/db/schema";
import { bundleResponse, servable } from "@/lib/bundle-response";
import { errorResponse } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; version: string }> }
) {
  try {
    const { slug, version } = await params;
    const ext = db.select().from(extensions).where(eq(extensions.slug, slug)).get();
    if (!ext || (ext.status !== "approved" && ext.status !== "archived")) {
      return errorResponse("Extension not found", 404);
    }
    const v = db.select().from(extensionVersions).where(and(eq(extensionVersions.extensionId, ext.id), eq(extensionVersions.version, version))).get();
    if (!servable(ext, v)) {
      return errorResponse("Version not found", 404);
    }
    return await bundleResponse(request, ext, v);
  } catch (error) {
    console.error("Error downloading bundle:", error);
    return errorResponse("Internal server error", 500);
  }
}
