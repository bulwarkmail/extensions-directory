import { getStats } from "@/lib/db/queries";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function GET() {
  try {
    const stats = await getStats();
    return jsonResponse({ data: stats });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return errorResponse("Internal server error", 500);
  }
}
