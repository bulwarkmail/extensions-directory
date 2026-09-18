import { getAuthorSession, getAdminSession } from "@/lib/auth";
import { jsonResponse } from "@/lib/utils";

export async function POST() {
  const authorSession = await getAuthorSession();
  const adminSession = await getAdminSession();

  authorSession.destroy();
  adminSession.destroy();

  return jsonResponse({ ok: true });
}
