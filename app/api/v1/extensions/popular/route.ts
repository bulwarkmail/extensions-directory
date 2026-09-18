import { getPopularExtensions } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function GET() {
  try {
    const popular = await getPopularExtensions();
    return jsonResponse({ data: popular });
  } catch (error) {
    console.error("Error fetching popular:", error);
    return errorResponse("Internal server error", 500);
  }
}
