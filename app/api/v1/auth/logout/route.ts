import { assertSameOrigin, getSession, HttpError } from "@/lib/auth/session";
import { jsonResponse, errorResponse } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.message, err.status);
    throw err;
  }
  const session = await getSession();
  session.destroy();
  return jsonResponse({ ok: true });
}
