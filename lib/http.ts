// JSON helpers for the v2 API: { data } on success, { error: { code, message } }
// on failure, and one wrapper that turns thrown errors into responses.
import { Forbidden } from "@/lib/auth/guard";
import { HttpError } from "@/lib/auth/session";

export function ok(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json({ data }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function fail(status: number, code: string, message: string, details?: unknown, headers: Record<string, string> = {}): Response {
  return Response.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.code, err.message, undefined, err.status === 429 ? { "Retry-After": "60" } : {});
      if (err instanceof Forbidden) return fail(403, "forbidden", err.message);
      console.error("api error:", err);
      return fail(500, "internal", "Internal server error");
    }
  };
}

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request body is too large", "too_large");
  if (!text) return {} as T;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new HttpError(400, "Body must be a JSON object", "bad_json");
  }
}

export function str(v: unknown, field: string, opts: { max?: number; optional?: boolean } = {}): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return undefined;
    throw new HttpError(400, `${field} is required`, "bad_request");
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string`, "bad_request");
  const s = v.trim();
  if (s.length > (opts.max ?? 500)) throw new HttpError(400, `${field} is too long`, "bad_request");
  return s;
}
