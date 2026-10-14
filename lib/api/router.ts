// A small router for /api/v2: one catch-all route file dispatches to a table
// of handlers (lib/api/v2.ts), so the API reads as one list and tests call
// it without Next's file routing.
import { HttpError, assertSameOrigin, currentUser, hasRole, type SessionUser } from "@/lib/auth/session";
import type { Role } from "@/lib/db/schema";
import { clientIp, hashIp } from "@/lib/audit";
import { hit, LIMITS } from "@/lib/ratelimit";
import { fail, handle } from "@/lib/http";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface Ctx {
  request: Request;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The signed-in user; set when the route requires one. */
  user: SessionUser;
  ipHash: string;
}

export interface Route {
  method: Method;
  path: string;
  /** null: public. "user": any signed-in account. A role: that role or higher. */
  auth: null | "user" | Role;
  handler: (ctx: Ctx) => Promise<Response>;
}

function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) {
      try {
        params[p[i].slice(1)] = decodeURIComponent(s[i]);
      } catch {
        return null;
      }
    } else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function router(routes: Route[], base = "/api/v2") {
  return (method: Method) =>
    handle(async (request: Request) => {
      const url = new URL(request.url);
      // next.config.ts rewrites the well-known keyring address here; a
      // rewrite keeps the original URL, so map it by hand.
      const path = url.pathname === "/.well-known/bulwark-extension-keys.json" ? "/keys"
        : url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
      let allowed = false;
      for (const r of routes) {
        const params = match(r.path, path);
        if (!params) continue;
        allowed = true;
        if (r.method !== method) continue;
        const ipHash = hashIp(clientIp(request)) ?? "unknown";
        let user = null as SessionUser | null;
        if (r.auth) {
          user = await currentUser();
          if (!user) throw new HttpError(401, "Sign in first", "unauthorized");
          if (r.auth !== "user" && !hasRole(user.role, r.auth)) throw new HttpError(403, "Not allowed", "forbidden");
        }
        if (method !== "GET") {
          // Cookie-authenticated writes must come from our pages, and every
          // write counts against the caller's address.
          if (r.auth) assertSameOrigin(request);
          hit([LIMITS.writesPerIp(ipHash)]);
        }
        return r.handler({ request, params, query: url.searchParams, user: user as SessionUser, ipHash });
      }
      return allowed ? fail(405, "method_not_allowed", "Method not allowed") : fail(404, "not_found", "No such endpoint");
    });
}
