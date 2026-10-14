// /api/v2: everything except POST /publish, /publish/dry-run and
// /submissions/{id}, which have their own route files. docs/api.md lists it.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  apiTokens, auditLog, authors, extensionMembers, extensions, extensionVersions, keyrings, publishers, reports,
  ratings, submissions, textChanges, webhooks, advisories, OPEN_STATUSES, SOURCE_HOSTS, type Role, type SourceHost, type TokenScope,
} from "@/lib/db/schema";
import { HttpError } from "@/lib/auth/session";
import { memberRole } from "@/lib/auth/guard";
import { createToken, revokeToken, tokensOf } from "@/lib/auth/tokens";
import { ok, readJson, str } from "@/lib/http";
import { advisoriesFor, extensionBySlug, latestFor, listExtensions, mediaOf, newest, ratingSummary, releasesOf, type Channel } from "@/lib/catalog";
import { advisoryView, createAdvisory, handleReport, hideRating, rate, ratingsOf, removeRating, report, updateAdvisory } from "@/lib/community";
import {
  addMember, addPublisher, banAuthor, decideTextChange, deprecate, extensionOr404, membersOf, proposeTextChange, removeMember,
  removePublisher, setArchived, setFeatured, setMaxAppVersion, setRole, setSource, setVerified, suspend, unbanAuthor, undeprecate,
  unsuspend, unyankVersion, yankVersion,
} from "@/lib/lifecycle";
import { createSubmission, reserveExtension } from "@/lib/publishing/submit";
import { submissionView } from "@/lib/publishing/view";
import { approveSubmission, rebuildSubmission, rejectSubmission, withdrawSubmission } from "@/lib/review";
import { bundleResponse, servable } from "@/lib/bundle-response";
import { downloadsByDay } from "@/lib/downloads";
import { extensionSummary, fileUrl, versionBrief, versionFull, authorView } from "@/lib/api/views";
import { compare, isValid } from "@/lib/semver";
import { cleanSubpath, isValidRepo, parseRepoUrl, source } from "@/lib/sources";
import { readStaged } from "@/lib/pipeline/staging";
import { readZipFiles } from "@/lib/pipeline/diff";
import { getStoredFile } from "@/lib/storage";
import { validWebhookUrl, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { hit, LIMITS } from "@/lib/ratelimit";
import { KNOWN_PERMISSIONS, permissionText, HIGH_RISK_PERMISSIONS } from "@/lib/webmail-compat";
import type { Ctx, Route } from "./router";
import crypto from "crypto";

const actorOf = (ctx: Ctx, admin = false) => ({ kind: admin ? ("admin" as const) : ("author" as const), id: ctx.user.id });

function filterOf(q: URLSearchParams) {
  const appVersion = q.get("appVersion");
  return { appVersion: appVersion && isValid(appVersion) ? appVersion : null, channel: (q.get("channel") === "beta" ? "beta" : "stable") as Channel };
}

/** Listed (or archived) extension, else 404. */
function publicExtension(slug: string) {
  const row = extensionBySlug(slug);
  if (!row || (row.e.status !== "approved" && row.e.status !== "archived")) throw new HttpError(404, "Extension not found", "not_found");
  return row;
}

/** The extension, if the signed-in user maintains it (owner when asked) or is staff. */
async function managed(ctx: Ctx, opts: { owner?: boolean } = {}) {
  const ext = extensionOr404(ctx.params.slug);
  const role = await memberRole(ctx.user.id, ext.id);
  const staff = ctx.user.role === "admin" || ctx.user.role === "super_admin";
  if (!role && !staff) throw new HttpError(404, "Extension not found", "not_found");
  if (opts.owner && role !== "owner" && !staff) throw new HttpError(403, "Only an owner can do this", "forbidden");
  if (ext.status === "suspended" && !staff) throw new HttpError(403, `This extension is suspended${ext.suspendedReason ? `: ${ext.suspendedReason}` : ""}`, "suspended");
  return { ext, staff, actor: { kind: staff && !role ? ("admin" as const) : ("author" as const), id: ctx.user.id } };
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") throw new HttpError(400, `${field} must be true or false`, "bad_request");
  return v;
}

const page = (q: URLSearchParams) => ({ page: Math.max(1, Number(q.get("page")) || 1), perPage: Math.min(100, Math.max(1, Number(q.get("perPage")) || 50)) });

// ── public ───────────────────────────────────────────────────────────────────

const publicRoutes: Route[] = [
  {
    method: "GET", path: "/extensions", auth: null,
    handler: async ({ query }) => {
      const f = filterOf(query);
      const { rows, total, page: p, perPage } = listExtensions({
        type: (query.get("type") as "plugin") || undefined, pluginType: query.get("pluginType") || undefined, tag: query.get("tag") || undefined,
        author: query.get("author") || undefined, q: query.get("q")?.slice(0, 100) || undefined, sort: query.get("sort") || undefined,
        order: query.get("order") === "asc" ? "asc" : "desc", page: Number(query.get("page")) || 1, perPage: Number(query.get("perPage")) || 24,
        featured: query.get("featured") === "true" ? true : undefined,
      });
      const releases = releasesOf(rows.map((r) => r.e.id));
      const ratingsBy = ratingSummary(rows.map((r) => r.e.id));
      return Response.json({
        data: rows.map(({ e, a }) => extensionSummary(e, a, latestFor(releases.get(e.id) ?? [], f), ratingsBy.get(e.id))),
        meta: { page: p, perPage, total },
      });
    },
  },
  {
    method: "GET", path: "/extensions/:slug", auth: null,
    handler: async ({ params, query }) => {
      const { e, a } = publicExtension(params.slug);
      const f = filterOf(query);
      const all = releasesOf([e.id]).get(e.id) ?? [];
      const latest = latestFor(all, f);
      const media = mediaOf(e.id);
      return ok({
        ...extensionSummary(e, a, latest, ratingSummary([e.id]).get(e.id)),
        longDescription: e.longDescription,
        newest: newest(all, f) ? versionBrief(newest(all, f)!, e.slug) : null,
        versions: all.filter((v) => !v.yankedAt && (f.channel === "beta" || v.channel === "stable")).map((v) => versionBrief(v, e.slug)),
        screenshots: media.screenshots.map((s) => ({ url: fileUrl(s.path), altText: s.altText })),
        themePreviews: media.themePreviews.map((p) => ({ variant: p.variant, url: fileUrl(p.previewPath), colors: p.colors })),
        advisories: advisoriesFor(e.id).map((x) => advisoryView(x, e.slug)),
        permissions: (latest?.permissions ?? e.permissions ?? []).map((p) => ({ id: p, ...(permissionText(p) ?? { title: p, body: "" }), highRisk: HIGH_RISK_PERMISSIONS.has(p) })),
      });
    },
  },
  {
    method: "GET", path: "/extensions/:slug/versions", auth: null,
    handler: async ({ params, query }) => {
      const { e } = publicExtension(params.slug);
      const include = new Set((query.get("include") ?? "").split(","));
      const all = releasesOf([e.id]).get(e.id) ?? [];
      return ok(all.filter((v) => (include.has("yanked") || !v.yankedAt) && (include.has("beta") || v.channel === "stable")).map((v) => versionFull(v, e.slug)));
    },
  },
  {
    method: "GET", path: "/extensions/:slug/versions/:version", auth: null,
    handler: async ({ params }) => {
      const { e } = publicExtension(params.slug);
      const v = (releasesOf([e.id]).get(e.id) ?? []).find((x) => x.version === params.version);
      if (!v) throw new HttpError(404, "Version not found", "not_found");
      return ok({ ...versionFull(v, e.slug), advisories: advisoriesFor(e.id, v.version).map((x) => advisoryView(x, e.slug)) });
    },
  },
  {
    method: "GET", path: "/extensions/:slug/versions/:version/bundle", auth: null,
    handler: async ({ params, request }) => {
      const row = extensionBySlug(params.slug);
      const v = row ? db.select().from(extensionVersions).where(and(eq(extensionVersions.extensionId, row.e.id), eq(extensionVersions.version, params.version))).get() : null;
      if (!row || !servable(row.e, v)) throw new HttpError(404, "Version not found", "not_found");
      return bundleResponse(request, row.e, v);
    },
  },
  {
    method: "GET", path: "/extensions/:slug/versions/:version/provenance", auth: null,
    handler: async ({ params }) => {
      const { e } = publicExtension(params.slug);
      const v = (releasesOf([e.id]).get(e.id) ?? []).find((x) => x.version === params.version);
      if (!v) throw new HttpError(404, "Version not found", "not_found");
      const full = versionFull(v, e.slug);
      // An in-toto statement with a SLSA v1 predicate: the directory built it.
      return Response.json({
        _type: "https://in-toto.io/Statement/v1",
        subject: [{ name: `${e.slug}-${v.version}.zip`, digest: { sha256: v.bundleSha256 } }],
        predicateType: "https://slsa.dev/provenance/v1",
        predicate: {
          buildDefinition: {
            buildType: "https://extensions.bulwarkmail.org/build/v1",
            externalParameters: { source: full.provenance.source, submittedVia: v.submittedVia },
            internalParameters: { builtWith: v.buildSource, image: v.builderImage },
            resolvedDependencies: v.sourceCommit ? [{ uri: `git+https://${full.provenance.source.host}/${v.sourceRepo}`, digest: { gitCommit: v.sourceCommit } }] : [],
          },
          runDetails: { builder: { id: "https://extensions.bulwarkmail.org/worker" }, metadata: { finishedOn: v.publishedAt }, ci: full.provenance.ci },
        },
        signature: full.signature,
      }, { headers: { "Cache-Control": "public, max-age=3600" } });
    },
  },
  {
    method: "GET", path: "/extensions/:slug/ratings", auth: null,
    handler: async ({ params }) => {
      const { e } = publicExtension(params.slug);
      return ok({ summary: ratingSummary([e.id]).get(e.id) ?? { average: 0, count: 0 }, ratings: ratingsOf(e.id) });
    },
  },
  {
    method: "POST", path: "/extensions/:slug/reports", auth: null,
    handler: async (ctx) => {
      hit([LIMITS.reportsPerIp(ctx.ipHash)]);
      const body = await readJson(ctx.request);
      // A filled honeypot field means a bot; answer as if it worked.
      if (typeof body.website === "string" && body.website) return ok({ received: true }, 201);
      const { e } = publicExtension(ctx.params.slug);
      const { currentUser } = await import("@/lib/auth/session");
      const user = await currentUser();
      const staff = db.select({ id: authors.id }).from(authors).where(inArray(authors.role, ["admin", "super_admin"])).all().map((s) => s.id);
      const r = await report(e, {
        reason: str(body.reason, "reason", { max: 40 })!, details: str(body.details, "details", { max: 5000 })!,
        version: str(body.version, "version", { optional: true, max: 64 }) ?? null, contactEmail: str(body.contactEmail, "contactEmail", { optional: true, max: 200 }) ?? null,
        reporterId: user?.id ?? null, ipHash: ctx.ipHash,
      }, () => staff);
      return ok({ received: true, id: r.id }, 201);
    },
  },
  {
    method: "POST", path: "/updates", auth: null,
    handler: async ({ request }) => {
      const body = await readJson<{ appVersion?: unknown; channel?: unknown; installed?: unknown }>(request, 256 * 1024);
      if (!Array.isArray(body.installed) || body.installed.length > 500) throw new HttpError(400, "installed must be a list of up to 500 { slug, version }", "bad_request");
      const installed = body.installed.filter((i): i is { slug: string; version: string } => !!i && typeof i.slug === "string" && typeof i.version === "string");
      const f = { appVersion: typeof body.appVersion === "string" && isValid(body.appVersion) ? body.appVersion : null, channel: (body.channel === "beta" ? "beta" : "stable") as Channel };
      const exts = installed.length ? db.select().from(extensions).where(inArray(extensions.slug, [...new Set(installed.map((i) => i.slug))])).all() : [];
      const bySlug = new Map(exts.map((e) => [e.slug, e]));
      const releases = releasesOf(exts.map((e) => e.id));
      const out = { updates: [] as unknown[], yanked: [] as unknown[], deprecated: [] as unknown[], suspended: [] as string[], advisories: [] as unknown[], unknown: [] as string[] };
      for (const i of installed) {
        const e = bySlug.get(i.slug);
        if (!e || e.status === "pending" || e.status === "rejected") { out.unknown.push(i.slug); continue; }
        if (e.status === "suspended") { out.suspended.push(i.slug); }
        const all = releases.get(e.id) ?? [];
        const mine = all.find((v) => v.version === i.version);
        if (mine?.yankedAt) out.yanked.push({ slug: e.slug, version: mine.version, reason: mine.yankReason, at: mine.yankedAt });
        if (e.deprecatedAt) out.deprecated.push({ slug: e.slug, message: e.deprecationMessage, replacement: e.replacementSlug });
        for (const a of advisoriesFor(e.id, i.version)) out.advisories.push({ ...advisoryView(a, e.slug), installedVersion: i.version });
        if (e.status !== "suspended") {
          const latest = latestFor(all, f);
          if (latest && isValid(i.version) && compare(latest.version, i.version) > 0) {
            out.updates.push({ slug: e.slug, currentVersion: i.version, ...versionBrief(latest, e.slug), changelog: latest.changelog });
          }
        }
      }
      return ok(out);
    },
  },
  {
    method: "GET", path: "/advisories", auth: null,
    handler: async ({ query }) => {
      const since = query.get("since");
      const rows = db.select({ a: advisories, slug: extensions.slug }).from(advisories).innerJoin(extensions, eq(extensions.id, advisories.extensionId))
        .where(and(sql`${advisories.publishedAt} is not null`, since && !Number.isNaN(Date.parse(since)) ? sql`coalesce(${advisories.updatedAt}, ${advisories.publishedAt}) >= ${Math.floor(Date.parse(since) / 1000)}` : undefined))
        .orderBy(desc(advisories.publishedAt)).all();
      return ok(rows.map((r) => advisoryView(r.a, r.slug)));
    },
  },
  {
    method: "GET", path: "/keys", auth: null,
    handler: async () => {
      const doc = db.select().from(keyrings).orderBy(desc(keyrings.id)).limit(1).get();
      if (!doc) throw new HttpError(404, "No keyring published yet", "not_found");
      return new Response(doc.document, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
    },
  },
  {
    method: "GET", path: "/permissions", auth: null,
    handler: async () => ok(KNOWN_PERMISSIONS.map((p) => ({ id: p, ...(permissionText(p) ?? { title: p, body: "" }), highRisk: HIGH_RISK_PERMISSIONS.has(p) }))),
  },
];

// ── signed-in authors ────────────────────────────────────────────────────────

function sourceInput(body: Record<string, unknown>) {
  const raw = str(body.repository, "repository", { max: 300 })!;
  const parsed = parseRepoUrl(raw.includes("://") ? raw : `https://${typeof body.host === "string" ? body.host : "github.com"}/${raw}`);
  if (!parsed || !SOURCE_HOSTS.includes(parsed.host)) throw new HttpError(400, "repository must be owner/name on github.com, gitlab.com or codeberg.org, or its URL", "bad_request");
  const subpath = cleanSubpath(str(body.subpath, "subpath", { optional: true, max: 200 }) ?? parsed.subpath ?? "");
  if (subpath === null) throw new HttpError(400, "subpath must be a folder inside the repository", "bad_request");
  if (!isValidRepo(parsed.host, parsed.repo)) throw new HttpError(400, "Not a repository name", "bad_request");
  return { host: parsed.host as SourceHost, repo: parsed.repo, subpath, ref: parsed.ref };
}

const authorRoutes: Route[] = [
  {
    method: "GET", path: "/me", auth: "user",
    handler: async ({ user }) => ok({ id: user.id, login: user.githubLogin, name: user.displayName, avatarUrl: user.avatarUrl, email: user.email, role: user.role, notifyEmail: user.notifyEmail, verified: !!user.verified }),
  },
  {
    method: "PATCH", path: "/me", auth: "user",
    handler: async ({ user, request }) => {
      const body = await readJson(request);
      if (body.notifyEmail !== undefined) await db.update(authors).set({ notifyEmail: bool(body.notifyEmail, "notifyEmail") }).where(eq(authors.id, user.id));
      return ok({ saved: true });
    },
  },
  {
    method: "GET", path: "/me/extensions", auth: "user",
    handler: async ({ user }) => {
      const rows = db.select({ e: extensions, role: extensionMembers.role }).from(extensionMembers).innerJoin(extensions, eq(extensions.id, extensionMembers.extensionId))
        .where(eq(extensionMembers.authorId, user.id)).orderBy(desc(extensions.updatedAt)).all();
      const releases = releasesOf(rows.map((r) => r.e.id));
      const open = rows.length ? db.select().from(submissions).where(and(inArray(submissions.extensionId, rows.map((r) => r.e.id)), inArray(submissions.status, [...OPEN_STATUSES, "build_failed", "blocked"]), eq(submissions.dryRun, false))).orderBy(desc(submissions.submittedAt)).all() : [];
      return ok(rows.map(({ e, role }) => ({
        ...extensionSummary(e, null, newest(releases.get(e.id) ?? [], { channel: "beta", includeYanked: false }), undefined),
        role,
        reservedAt: e.reservedAt,
        suspendedReason: e.suspendedReason,
        openSubmissions: open.filter((s) => s.extensionId === e.id).slice(0, 5).map((s) => submissionView(s)),
      })));
    },
  },
  {
    method: "GET", path: "/me/submissions", auth: "user",
    handler: async ({ user, query }) => {
      const { page: p, perPage } = page(query);
      const rows = db.select().from(submissions).where(eq(submissions.authorId, user.id)).orderBy(desc(submissions.submittedAt)).limit(perPage).offset((p - 1) * perPage).all();
      return ok(rows.map((s) => submissionView(s)));
    },
  },
  {
    // Reserve a name and say where its source lives.
    method: "POST", path: "/extensions", auth: "user",
    handler: async ({ user, request }) => {
      const body = await readJson(request);
      const slug = str(body.slug, "slug", { max: 64 })!;
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) throw new HttpError(400, "The id must be lowercase letters, digits and dashes, as in manifest.json", "bad_request");
      const type = body.type === "theme" ? "theme" : "plugin";
      const src = sourceInput(body);
      const info = await source(src.host).repoInfo(src.repo).catch(() => null);
      if (!info) throw new HttpError(400, `Repository ${src.repo} does not exist on ${src.host}`, "repo_not_found");
      if (!info.isPublic) throw new HttpError(400, `Repository ${src.repo} is not public`, "repo_private");
      const ext = reserveExtension(user.id, { slug, name: str(body.name, "name", { optional: true, max: 100 }) ?? slug, description: str(body.description, "description", { optional: true, max: 500 }) ?? "", type, pluginType: type === "plugin" ? "hook" : null, host: src.host, repo: info.fullName, repoId: info.id, subpath: src.subpath });
      const { audit } = await import("@/lib/audit");
      await audit({ kind: "author", id: user.id }, "extension.reserve", { kind: "extension", id: ext.id }, { slug }, request);
      return ok({ slug: ext.slug, status: ext.status }, 201);
    },
  },
  {
    method: "GET", path: "/extensions/:slug/manage", auth: "user",
    handler: async (ctx) => {
      const { ext } = await managed(ctx);
      const versions = (releasesOf([ext.id]).get(ext.id) ?? []).map((v) => ({ ...versionFull(v, ext.slug) }));
      return ok({
        extension: { ...extensionSummary(ext, null, null), longDescription: ext.longDescription, reservedAt: ext.reservedAt, suspendedReason: ext.suspendedReason, sourceRepoId: ext.sourceRepoId },
        versions,
        members: membersOf(ext.id),
        publishers: db.select().from(publishers).where(eq(publishers.extensionId, ext.id)).all(),
        submissions: db.select().from(submissions).where(eq(submissions.extensionId, ext.id)).orderBy(desc(submissions.submittedAt)).limit(30).all().map((s) => submissionView(s)),
        textChanges: db.select().from(textChanges).where(eq(textChanges.extensionId, ext.id)).orderBy(desc(textChanges.proposedAt)).limit(30).all(),
      });
    },
  },
  {
    // Source changes apply at once; public text waits for review.
    method: "PATCH", path: "/extensions/:slug", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx);
      const body = await readJson(ctx.request, 64 * 1024);
      const proposed: string[] = [];
      if (body.repository !== undefined) await setSource(ext, sourceInput(body), actor, ctx.request);
      for (const [key, field] of [["description", "description"], ["longDescription", "long_description"]] as const) {
        if (typeof body[key] === "string" && body[key] !== (key === "description" ? ext.description : ext.longDescription ?? "")) {
          await proposeTextChange(ext, field, body[key] as string, null, actor, ctx.request);
          proposed.push(key);
        }
      }
      if (Array.isArray(body.tags)) {
        await proposeTextChange(ext, "tags", JSON.stringify(body.tags), null, actor, ctx.request);
        proposed.push("tags");
      }
      return ok({ saved: true, waitingForReview: proposed });
    },
  },
  {
    method: "POST", path: "/extensions/:slug/submissions", auth: "user",
    handler: async (ctx) => {
      const { ext } = await managed(ctx);
      const body = await readJson(ctx.request);
      const ref = str(body.ref, "ref", { max: 250 })!;
      const { submission, pollToken } = await createSubmission({
        authorId: ctx.user.id, actor: { kind: "author", id: ctx.user.id }, via: "web", extensionId: ext.id,
        host: ext.sourceHost, repo: ext.githubRepo, ref, subpath: ext.subpath, dryRun: body.dryRun === true, request: ctx.request,
      });
      return ok({ ...submissionView(submission), pollToken }, 202);
    },
  },
  {
    method: "DELETE", path: "/extensions/:slug/submissions/:id", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx);
      const s = db.select().from(submissions).where(and(eq(submissions.id, ctx.params.id), eq(submissions.extensionId, ext.id))).get();
      if (!s) throw new HttpError(404, "Submission not found", "not_found");
      await withdrawSubmission(s.id, actor, ctx.request);
      return ok({ withdrawn: true });
    },
  },
  {
    method: "POST", path: "/extensions/:slug/members", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx, { owner: true });
      const body = await readJson(ctx.request);
      await addMember(ext, str(body.login, "login", { max: 64 })!, body.role === "owner" ? "owner" : "maintainer", actor, ctx.request);
      return ok(membersOf(ext.id), 201);
    },
  },
  {
    method: "DELETE", path: "/extensions/:slug/members/:authorId", auth: "user",
    handler: async (ctx) => {
      // Owners remove anyone; maintainers may remove themselves.
      const { ext, actor } = await managed(ctx, { owner: ctx.params.authorId !== ctx.user.id });
      await removeMember(ext, ctx.params.authorId, actor, ctx.request);
      return ok(membersOf(ext.id));
    },
  },
  {
    method: "POST", path: "/extensions/:slug/publishers", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx);
      const body = await readJson(ctx.request);
      const subpath = cleanSubpath(str(body.subpath, "subpath", { optional: true, max: 200 }) ?? ext.subpath);
      if (subpath === null) throw new HttpError(400, "subpath must be a folder inside the repository", "bad_request");
      const row = await addPublisher(ext, {
        repository: str(body.repository, "repository", { max: 200 })!.replace(/^https:\/\/github\.com\//, ""),
        workflowPath: str(body.workflowPath, "workflowPath", { max: 200 })!,
        environment: str(body.environment, "environment", { optional: true, max: 100 }) ?? null,
        subpath,
        allowedRefs: body.allowedRefs === "any" ? "any" : "tags",
      }, actor, ctx.request);
      return ok(row, 201);
    },
  },
  {
    method: "DELETE", path: "/extensions/:slug/publishers/:id", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx);
      await removePublisher(ext, ctx.params.id, actor, ctx.request);
      return ok({ removed: true });
    },
  },
  {
    method: "PATCH", path: "/extensions/:slug/versions/:version", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx);
      const body = await readJson(ctx.request, 64 * 1024);
      const v = db.select().from(extensionVersions).where(and(eq(extensionVersions.extensionId, ext.id), eq(extensionVersions.version, ctx.params.version))).get();
      if (!v) throw new HttpError(404, "Version not found", "not_found");
      if (body.maxAppVersion !== undefined) await setMaxAppVersion(ext, v.version, body.maxAppVersion === null || body.maxAppVersion === "" ? null : str(body.maxAppVersion, "maxAppVersion", { max: 32 })!, actor, ctx.request);
      const waiting: string[] = [];
      if (typeof body.changelog === "string") {
        await proposeTextChange(ext, "changelog", body.changelog, v.id, actor, ctx.request);
        waiting.push("changelog");
      }
      return ok({ saved: true, waitingForReview: waiting });
    },
  },
  {
    method: "POST", path: "/extensions/:slug/versions/:version/yank", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx);
      const body = await readJson(ctx.request);
      await yankVersion(ext, ctx.params.version, str(body.reason, "reason", { max: 500 })!, actor, ctx.request);
      return ok({ yanked: true });
    },
  },
  {
    method: "POST", path: "/extensions/:slug/versions/:version/unyank", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx);
      await unyankVersion(ext, ctx.params.version, actor, ctx.request);
      return ok({ yanked: false });
    },
  },
  {
    method: "POST", path: "/extensions/:slug/deprecate", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx, { owner: true });
      const body = await readJson(ctx.request);
      await deprecate(ext, str(body.message, "message", { optional: true, max: 1000 }) ?? "", str(body.replacement, "replacement", { optional: true, max: 64 }) ?? null, actor, ctx.request);
      return ok({ deprecated: true });
    },
  },
  {
    method: "POST", path: "/extensions/:slug/undeprecate", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx, { owner: true });
      await undeprecate(ext, actor, ctx.request);
      return ok({ deprecated: false });
    },
  },
  {
    method: "POST", path: "/extensions/:slug/archive", auth: "user",
    handler: async (ctx) => {
      const { ext, actor } = await managed(ctx, { owner: true });
      const body = await readJson(ctx.request);
      await setArchived(ext, body.archived !== false, actor, ctx.request);
      return ok({ archived: body.archived !== false });
    },
  },
  {
    method: "GET", path: "/extensions/:slug/stats", auth: "user",
    handler: async (ctx) => {
      const { ext } = await managed(ctx);
      const days = Math.min(365, Math.max(7, Number(ctx.query.get("days")) || 90));
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const versions = db.select({ version: extensionVersions.version, downloads: extensionVersions.downloadCount, publishedAt: extensionVersions.publishedAt }).from(extensionVersions).where(eq(extensionVersions.extensionId, ext.id)).all()
        .sort((a, b) => compare(b.version, a.version));
      return ok({ total: ext.totalDownloads ?? 0, since, versions, daily: downloadsByDay(ext.id, since) });
    },
  },
  {
    method: "POST", path: "/extensions/:slug/rating", auth: "user",
    handler: async (ctx) => {
      const { e } = publicExtension(ctx.params.slug);
      const body = await readJson(ctx.request);
      await rate(e, ctx.user.id, Number(body.stars), str(body.body, "body", { optional: true, max: 2000 }) ?? null);
      return ok({ saved: true });
    },
  },
  {
    method: "DELETE", path: "/extensions/:slug/rating", auth: "user",
    handler: async (ctx) => {
      const { e } = publicExtension(ctx.params.slug);
      await removeRating(e, ctx.user.id);
      return ok({ removed: true });
    },
  },
  {
    method: "GET", path: "/tokens", auth: "user",
    handler: async ({ user }) => ok(tokensOf(user.id)),
  },
  {
    method: "POST", path: "/tokens", auth: "user",
    handler: async ({ user, request }) => {
      const body = await readJson(request);
      const slugs = Array.isArray(body.extensions) ? body.extensions.filter((s): s is string => typeof s === "string") : [];
      const exts = slugs.length ? db.select({ id: extensions.id, slug: extensions.slug }).from(extensions).where(inArray(extensions.slug, slugs)).all() : [];
      if (exts.length !== slugs.length) throw new HttpError(400, "Unknown extension in the list", "bad_request");
      const scopes = Array.isArray(body.scopes) ? (body.scopes as TokenScope[]) : ["publish" as TokenScope];
      const { token, row } = await createToken({ authorId: user.id, name: str(body.name, "name", { max: 80 })!, extensionIds: exts.map((e) => e.id), scopes, days: Number(body.days) || 90 }, { kind: "author", id: user.id }, request);
      return ok({ token, id: row.id, prefix: row.prefix, expiresAt: row.expiresAt, note: "Copy the token now; it is not shown again." }, 201);
    },
  },
  {
    method: "DELETE", path: "/tokens/:id", auth: "user",
    handler: async ({ user, params, request }) => {
      const t = db.select().from(apiTokens).where(and(eq(apiTokens.id, params.id), eq(apiTokens.authorId, user.id))).get();
      if (!t) throw new HttpError(404, "Token not found", "not_found");
      await revokeToken(t.id, { kind: "author", id: user.id }, "revoked by owner", request);
      return ok({ revoked: true });
    },
  },
  {
    method: "GET", path: "/webhooks", auth: "user",
    handler: async ({ user }) => ok(db.select({ id: webhooks.id, url: webhooks.url, events: webhooks.events, lastDeliveryAt: webhooks.lastDeliveryAt, lastStatus: webhooks.lastStatus, disabledAt: webhooks.disabledAt }).from(webhooks).where(eq(webhooks.authorId, user.id)).all()),
  },
  {
    method: "POST", path: "/webhooks", auth: "user",
    handler: async ({ user, request }) => {
      const body = await readJson(request);
      const url = validWebhookUrl(str(body.url, "url", { max: 500 })!);
      if (!url) throw new HttpError(400, "The URL must be https on a public host name", "bad_request");
      const events = Array.isArray(body.events) && body.events.length ? body.events.filter((e): e is string => WEBHOOK_EVENTS.includes(e as never)) : [...WEBHOOK_EVENTS];
      if (db.select({ n: sql<number>`count(*)` }).from(webhooks).where(eq(webhooks.authorId, user.id)).get()!.n >= 5) throw new HttpError(400, "At most 5 webhooks", "bad_request");
      const secret = crypto.randomBytes(24).toString("base64url");
      const [row] = await db.insert(webhooks).values({ authorId: user.id, url: url.toString(), secret, events }).returning();
      return ok({ id: row.id, url: row.url, events, secret, note: "Copy the secret now; it is not shown again. Check X-Bulwark-Signature with it." }, 201);
    },
  },
  {
    method: "DELETE", path: "/webhooks/:id", auth: "user",
    handler: async ({ user, params }) => {
      const res = db.delete(webhooks).where(and(eq(webhooks.id, params.id), eq(webhooks.authorId, user.id))).run();
      if (res.changes !== 1) throw new HttpError(404, "Webhook not found", "not_found");
      return ok({ removed: true });
    },
  },
];

// ── staff ────────────────────────────────────────────────────────────────────

const adminRoutes: Route[] = [
  {
    method: "GET", path: "/admin/submissions", auth: "reviewer",
    handler: async ({ query }) => {
      const status = query.get("status") ?? "awaiting_review";
      const rows = db.select({ s: submissions, a: authors, e: extensions }).from(submissions)
        .leftJoin(authors, eq(authors.id, submissions.authorId)).leftJoin(extensions, eq(extensions.id, submissions.extensionId))
        .where(and(status === "all" ? undefined : eq(submissions.status, status as "queued"), eq(submissions.dryRun, false)))
        .orderBy(status === "awaiting_review" ? asc(submissions.submittedAt) : desc(submissions.submittedAt)).limit(200).all();
      return ok(rows.map((r) => ({ ...submissionView(r.s), author: authorView(r.a), extension: r.e ? { slug: r.e.slug, name: r.e.name, status: r.e.status } : null })));
    },
  },
  {
    method: "GET", path: "/admin/submissions/:id", auth: "reviewer",
    handler: async ({ params }) => {
      const s = db.select().from(submissions).where(eq(submissions.id, params.id)).get();
      if (!s) throw new HttpError(404, "Submission not found", "not_found");
      const author = db.select().from(authors).where(eq(authors.id, s.authorId)).get() ?? null;
      const files = s.artifactPath ? [...(await readZipFiles(await readStaged(s.artifactPath))).entries()].map(([name, data]) => ({ name, size: data.length })) : [];
      return ok({ ...submissionView(s, { full: true }), manifest: s.manifestSnapshot, author: authorView(author), authorBanned: !!author?.bannedAt, files, reviewedBy: s.reviewedBy });
    },
  },
  {
    // One file of the staged bundle and the same file in the previous version, for the diff view.
    method: "GET", path: "/admin/submissions/:id/file", auth: "reviewer",
    handler: async ({ params, query }) => {
      const s = db.select().from(submissions).where(eq(submissions.id, params.id)).get();
      if (!s?.artifactPath) throw new HttpError(404, "No build", "not_found");
      const name = query.get("path") ?? "";
      const files = await readZipFiles(await readStaged(s.artifactPath));
      const data = files.get(name);
      if (!data) throw new HttpError(404, "No such file", "not_found");
      let previous: string | null = null;
      const prevVersion = (s.diffSummary as { previousVersion?: string } | null)?.previousVersion;
      if (prevVersion && s.extensionId) {
        const v = db.select().from(extensionVersions).where(and(eq(extensionVersions.extensionId, s.extensionId), eq(extensionVersions.version, prevVersion))).get();
        const zip = v ? await getStoredFile(v.bundlePath) : null;
        const prev = zip ? (await readZipFiles(zip)).get(name) : undefined;
        if (prev) previous = isText(prev) ? Buffer.from(prev).toString("utf8").slice(0, 1_000_000) : `[binary, ${prev.length} bytes]`;
      }
      return ok({ path: name, size: data.length, text: isText(data) ? Buffer.from(data).toString("utf8").slice(0, 1_000_000) : null, previous, previousVersion: prevVersion ?? null });
    },
  },
  ...(["approve", "reject", "rebuild"] as const).map((action): Route => ({
    method: "POST", path: `/admin/submissions/:id/${action}`, auth: "reviewer",
    handler: async (ctx) => {
      const body = await readJson(ctx.request, 64 * 1024);
      const notes = str(body.notes, "notes", { optional: true, max: 10_000 }) ?? null;
      if (action === "approve") await approveSubmission(ctx.params.id, ctx.user.id, notes, ctx.request);
      else if (action === "reject") await rejectSubmission(ctx.params.id, ctx.user.id, notes ?? "", ctx.request);
      else await rebuildSubmission(ctx.params.id, actorOf(ctx, true), ctx.request);
      return ok(submissionView(db.select().from(submissions).where(eq(submissions.id, ctx.params.id)).get()!));
    },
  })),
  {
    method: "GET", path: "/admin/text-changes", auth: "reviewer",
    handler: async () => ok(db.select({ t: textChanges, slug: extensions.slug, login: authors.githubLogin }).from(textChanges)
      .innerJoin(extensions, eq(extensions.id, textChanges.extensionId)).leftJoin(authors, eq(authors.id, textChanges.proposedBy))
      .where(eq(textChanges.status, "pending")).orderBy(asc(textChanges.proposedAt)).all()
      .map((r) => ({ ...r.t, slug: r.slug, proposedByLogin: r.login }))),
  },
  ...(["approve", "reject"] as const).map((action): Route => ({
    method: "POST", path: `/admin/text-changes/:id/${action}`, auth: "reviewer",
    handler: async (ctx) => {
      const body = await readJson(ctx.request);
      await decideTextChange(ctx.params.id, action === "approve", ctx.user.id, str(body.notes, "notes", { optional: true, max: 5000 }) ?? null, ctx.request);
      return ok({ decided: action });
    },
  })),
  {
    method: "GET", path: "/admin/authors", auth: "admin",
    handler: async ({ query }) => {
      const q = query.get("q");
      const rows = db.select({ a: authors, n: sql<number>`(select count(*) from extension_members m where m.author_id = ${authors.id})` }).from(authors)
        .where(q ? sql`${authors.githubLogin} like ${`%${q}%`}` : undefined).orderBy(desc(authors.createdAt)).limit(500).all();
      return ok(rows.map(({ a, n }) => ({ id: a.id, login: a.githubLogin, name: a.displayName, avatarUrl: a.avatarUrl, email: a.email, role: a.role, verified: !!a.verified, bannedAt: a.bannedAt, bannedReason: a.bannedReason, createdAt: a.createdAt, extensions: n })));
    },
  },
  {
    method: "POST", path: "/admin/authors/:id", auth: "admin",
    handler: async (ctx) => {
      const body = await readJson(ctx.request);
      const actor = actorOf(ctx, true);
      switch (body.action) {
        case "ban": await banAuthor(ctx.params.id, str(body.reason, "reason", { max: 500 })!, actor, ctx.request); break;
        case "unban": await unbanAuthor(ctx.params.id, actor, ctx.request); break;
        case "verify": await setVerified(ctx.params.id, true, actor, ctx.request); break;
        case "unverify": await setVerified(ctx.params.id, false, actor, ctx.request); break;
        case "role":
          if (ctx.user.role !== "super_admin") throw new HttpError(403, "Only a super admin changes roles", "forbidden");
          await setRole(ctx.params.id, str(body.role, "role", { max: 20 }) as Role, actor, ctx.request);
          break;
        default: throw new HttpError(400, "action must be ban, unban, verify, unverify or role", "bad_request");
      }
      return ok({ done: body.action });
    },
  },
  {
    method: "GET", path: "/admin/extensions", auth: "reviewer",
    handler: async () => {
      const rows = db.select({ e: extensions, a: authors }).from(extensions).leftJoin(authors, eq(authors.id, extensions.authorId)).orderBy(desc(extensions.updatedAt)).all();
      const releases = releasesOf(rows.map((r) => r.e.id));
      return ok(rows.map(({ e, a }) => ({ ...extensionSummary(e, a, newest(releases.get(e.id) ?? [], { channel: "beta" })), suspendedReason: e.suspendedReason, reservedAt: e.reservedAt })));
    },
  },
  {
    method: "POST", path: "/admin/extensions/:slug", auth: "admin",
    handler: async (ctx) => {
      const ext = extensionOr404(ctx.params.slug);
      const body = await readJson(ctx.request);
      const actor = actorOf(ctx, true);
      switch (body.action) {
        case "suspend": await suspend(ext, str(body.reason, "reason", { max: 500 })!, actor, ctx.request); break;
        case "unsuspend": await unsuspend(ext, actor, ctx.request); break;
        case "feature": await setFeatured(ext, true, actor, ctx.request); break;
        case "unfeature": await setFeatured(ext, false, actor, ctx.request); break;
        case "yank": await yankVersion(ext, str(body.version, "version", { max: 64 })!, str(body.reason, "reason", { max: 500 })!, actor, ctx.request); break;
        case "unyank": await unyankVersion(ext, str(body.version, "version", { max: 64 })!, actor, ctx.request); break;
        case "add-owner": await addMember(ext, str(body.login, "login", { max: 64 })!, "owner", actor, ctx.request); break;
        default: throw new HttpError(400, "Unknown action", "bad_request");
      }
      return ok({ done: body.action });
    },
  },
  {
    method: "GET", path: "/admin/tokens", auth: "admin",
    handler: async () => ok(db.select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, scopes: apiTokens.scopes, expiresAt: apiTokens.expiresAt, lastUsedAt: apiTokens.lastUsedAt, revokedAt: apiTokens.revokedAt, createdAt: apiTokens.createdAt, login: authors.githubLogin })
      .from(apiTokens).innerJoin(authors, eq(authors.id, apiTokens.authorId)).orderBy(desc(apiTokens.createdAt)).limit(500).all()),
  },
  {
    method: "POST", path: "/admin/tokens/:id/revoke", auth: "admin",
    handler: async (ctx) => {
      const body = await readJson(ctx.request);
      await revokeToken(ctx.params.id, actorOf(ctx, true), str(body.reason, "reason", { optional: true, max: 500 }) ?? "revoked by staff", ctx.request);
      return ok({ revoked: true });
    },
  },
  {
    method: "GET", path: "/admin/reports", auth: "reviewer",
    handler: async ({ query }) => ok(db.select({ r: reports, slug: extensions.slug }).from(reports).innerJoin(extensions, eq(extensions.id, reports.extensionId))
      .where(query.get("status") === "all" ? undefined : eq(reports.status, (query.get("status") ?? "open") as "open")).orderBy(desc(reports.createdAt)).limit(300).all()
      .map(({ r, slug }) => ({ ...r, reporterIpHash: undefined, slug }))),
  },
  {
    method: "POST", path: "/admin/reports/:id", auth: "reviewer",
    handler: async (ctx) => {
      const body = await readJson(ctx.request);
      const status = body.status === "dismissed" ? "dismissed" : body.status === "open" ? "open" : "actioned";
      await handleReport(ctx.params.id, status, str(body.notes, "notes", { optional: true, max: 5000 }) ?? null, actorOf(ctx, true), ctx.request);
      return ok({ status });
    },
  },
  {
    method: "GET", path: "/admin/ratings", auth: "reviewer",
    handler: async () => ok(db.select({ r: ratings, slug: extensions.slug, login: authors.githubLogin }).from(ratings).innerJoin(extensions, eq(extensions.id, ratings.extensionId)).innerJoin(authors, eq(authors.id, ratings.authorId)).orderBy(desc(ratings.updatedAt)).limit(300).all()
      .map(({ r, slug, login }) => ({ ...r, slug, login }))),
  },
  {
    method: "POST", path: "/admin/ratings/:id", auth: "reviewer",
    handler: async (ctx) => {
      const body = await readJson(ctx.request);
      await hideRating(ctx.params.id, body.hidden !== false, actorOf(ctx, true), ctx.request);
      return ok({ hidden: body.hidden !== false });
    },
  },
  {
    method: "GET", path: "/admin/advisories", auth: "reviewer",
    handler: async () => ok(db.select({ a: advisories, slug: extensions.slug }).from(advisories).innerJoin(extensions, eq(extensions.id, advisories.extensionId)).orderBy(desc(advisories.createdAt)).all()
      .map(({ a, slug }) => ({ ...advisoryView(a, slug), draft: !a.publishedAt }))),
  },
  {
    method: "POST", path: "/admin/advisories", auth: "admin",
    handler: async (ctx) => {
      const body = await readJson(ctx.request, 64 * 1024);
      const ext = extensionOr404(str(body.extension, "extension", { max: 64 })!);
      const row = await createAdvisory(ext, {
        affected: str(body.affected, "affected", { max: 200 })!, fixedIn: str(body.fixedIn, "fixedIn", { optional: true, max: 64 }) ?? null,
        severity: str(body.severity, "severity", { max: 20 })!, summary: str(body.summary, "summary", { max: 300 })!,
        details: str(body.details, "details", { optional: true, max: 20_000 }) ?? "", publish: body.publish === true,
      }, actorOf(ctx, true), ctx.request);
      return ok(advisoryView(row, ext.slug), 201);
    },
  },
  {
    method: "PATCH", path: "/admin/advisories/:id", auth: "admin",
    handler: async (ctx) => {
      const body = await readJson(ctx.request, 64 * 1024);
      await updateAdvisory(ctx.params.id, {
        affected: str(body.affected, "affected", { optional: true, max: 200 }), fixedIn: body.fixedIn === null ? null : str(body.fixedIn, "fixedIn", { optional: true, max: 64 }),
        severity: str(body.severity, "severity", { optional: true, max: 20 }), summary: str(body.summary, "summary", { optional: true, max: 300 }),
        details: str(body.details, "details", { optional: true, max: 20_000 }), publish: body.publish === true, withdraw: body.withdraw === true,
      }, actorOf(ctx, true), ctx.request);
      return ok({ saved: true });
    },
  },
  {
    method: "GET", path: "/admin/audit", auth: "admin",
    handler: async ({ query }) => {
      const { page: p, perPage } = page(query);
      const conds = [
        query.get("action") ? sql`${auditLog.action} like ${`${query.get("action")}%`}` : undefined,
        query.get("actor") ? eq(auditLog.actorId, query.get("actor")!) : undefined,
        query.get("target") ? eq(auditLog.targetId, query.get("target")!) : undefined,
      ].filter(Boolean);
      const rows = db.select({ l: auditLog, login: authors.githubLogin }).from(auditLog).leftJoin(authors, eq(authors.id, auditLog.actorId))
        .where(conds.length ? and(...conds) : undefined).orderBy(desc(auditLog.id)).limit(perPage).offset((p - 1) * perPage).all();
      return ok(rows.map(({ l, login }) => ({ ...l, actorLogin: login, ipHash: undefined })));
    },
  },
];

function isText(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8000);
  for (let i = 0; i < n; i++) if (data[i] === 0) return false;
  return true;
}

export const v2Routes: Route[] = [...publicRoutes, ...authorRoutes, ...adminRoutes];
