import { getFeaturedExtensions } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";
import { v1ListItem } from "@/lib/v1/serialize";

export async function GET() {
  try {
    const featured = await getFeaturedExtensions();
    return jsonResponse({ data: featured.map((e) => v1ListItem(e, false)) });
  } catch (error) {
    console.error("Error fetching featured:", error);
    return errorResponse("Internal server error", 500);
  }
}
