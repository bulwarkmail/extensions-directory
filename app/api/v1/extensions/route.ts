import { NextRequest } from "next/server";
import { jsonResponse, errorResponse } from "@/lib/utils";
import { v1List } from "@/lib/v1/catalog";

export async function GET(request: NextRequest) {
  try {
    return jsonResponse(v1List(request.nextUrl.searchParams));
  } catch (error) {
    console.error("Error fetching extensions:", error);
    return errorResponse("Internal server error", 500);
  }
}
