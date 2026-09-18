import { NextRequest } from "next/server";
import { getExtensions } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const result = await getExtensions({
      type: (searchParams.get("type") as "plugin" | "theme") || undefined,
      pluginType: searchParams.get("pluginType") || undefined,
      tag: searchParams.get("tag") || undefined,
      authorLogin: searchParams.get("author") || undefined,
      q: searchParams.get("q") || undefined,
      sort: searchParams.get("sort") || "newest",
      order: (searchParams.get("order") as "asc" | "desc") || "desc",
      page: parseInt(searchParams.get("page") || "1", 10),
      perPage: parseInt(searchParams.get("perPage") || "24", 10),
    });

    return jsonResponse(result);
  } catch (error) {
    console.error("Error fetching extensions:", error);
    return errorResponse("Internal server error", 500);
  }
}
