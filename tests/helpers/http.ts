import crypto from "crypto";
import { NextRequest } from "next/server";

export const BASE = "https://extensions.test";

export function req(pathAndQuery: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new NextRequest(new URL(pathAndQuery, BASE), {
    method: init.method ?? "GET",
    headers: { "user-agent": "vitest", "x-forwarded-for": "203.0.113.7", ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export const params = <T extends Record<string, unknown>>(p: T) => ({ params: Promise.resolve(p) });

const KEPT_HEADERS = [
  "content-type",
  "content-disposition",
  "content-length",
  "cache-control",
  "x-content-sha256",
  "x-content-type-options",
  "content-security-policy",
];

/** Status, the headers clients look at, and the body (JSON, or a hash for binary). */
export async function snapshotOf(res: Response) {
  const headers: Record<string, string> = {};
  for (const h of KEPT_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) headers[h] = v;
  }
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    return { status: res.status, headers, json: await res.json() };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    headers,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}
