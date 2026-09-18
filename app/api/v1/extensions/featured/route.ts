import { getFeaturedExtensions } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function GET() {
  try {
    const featured = await getFeaturedExtensions();
    return jsonResponse({ data: featured });
  } catch (error) {
    console.error("Error fetching featured:", error);
    return errorResponse("Internal server error", 500);
  }
}
