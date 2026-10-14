import { getRecentExtensions } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";
import { v1ListItem } from "@/lib/v1/serialize";

export async function GET() {
  try {
    const recent = await getRecentExtensions();
    return jsonResponse({ data: recent.map((e) => v1ListItem(e, false)) });
  } catch (error) {
    console.error("Error fetching recent:", error);
    return errorResponse("Internal server error", 500);
  }
}
