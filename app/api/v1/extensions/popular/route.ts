import { getPopularExtensions } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";
import { v1ListItem } from "@/lib/v1/serialize";

export async function GET() {
  try {
    const popular = await getPopularExtensions();
    return jsonResponse({ data: popular.map((e) => v1ListItem(e, false)) });
  } catch (error) {
    console.error("Error fetching popular:", error);
    return errorResponse("Internal server error", 500);
  }
}
