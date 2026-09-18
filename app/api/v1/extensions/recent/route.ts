import { getRecentExtensions } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function GET() {
  try {
    const recent = await getRecentExtensions();
    return jsonResponse({ data: recent });
  } catch (error) {
    console.error("Error fetching recent:", error);
    return errorResponse("Internal server error", 500);
  }
}
