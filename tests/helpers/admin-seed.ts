// Staff-only rows with a marker text each, and the table of admin routes with the role each one
// needs. Used by tests/admin-pages-auth.test.ts (page functions and data readers) and by
// tests/http/admin-pages.http.ts (the built app over HTTP).
import crypto from "crypto";

export const SUB_ID = "0f0f0f0f-1111-4222-8333-444444444444";

export const MARK = {
  reporter: "private-reporter@example.org",
  reportText: "REPORT-DETAILS-MARKER the plugin sends my mail away",
  draft: "DRAFT-ADVISORY-MARKER",
  pendingText: "PENDING-TEXT-MARKER",
  queued: "queued-secret-plugin",
  manifest: "MANIFEST-MARKER",
  buildLog: "BUILD-LOG-MARKER",
  rating: "HIDDEN-RATING-MARKER",
  account: "ghost-account-marker",
  token: "TOKEN-NAME-MARKER",
  audit: "audit.marker-action",
  counts: "versions waiting for review",
};

export interface AdminRoute {
  /** Path of the page file under app/admin. */
  file: string;
  /** URL path, with the query that shows the most. */
  url: string;
  /** Lowest role that may see it. */
  needs: "reviewer" | "admin";
  /** Texts that only this route's data produces. */
  marks: string[];
}

export const ADMIN_ROUTES: AdminRoute[] = [
  { file: "page.tsx", url: "/admin", needs: "reviewer", marks: [MARK.counts] },
  { file: "submissions/page.tsx", url: "/admin/submissions?status=all", needs: "reviewer", marks: [MARK.queued] },
  { file: "submissions/[id]/page.tsx", url: `/admin/submissions/${SUB_ID}`, needs: "reviewer", marks: [MARK.manifest, MARK.buildLog] },
  { file: "reports/page.tsx", url: "/admin/reports?status=all", needs: "reviewer", marks: [MARK.reporter, MARK.reportText] },
  { file: "advisories/page.tsx", url: "/admin/advisories", needs: "reviewer", marks: [MARK.draft] },
  { file: "text-changes/page.tsx", url: "/admin/text-changes", needs: "reviewer", marks: [MARK.pendingText] },
  { file: "ratings/page.tsx", url: "/admin/ratings", needs: "reviewer", marks: [MARK.rating] },
  { file: "extensions/page.tsx", url: "/admin/extensions", needs: "reviewer", marks: [MARK.queued] },
  { file: "authors/page.tsx", url: "/admin/authors", needs: "admin", marks: [MARK.account] },
  { file: "tokens/page.tsx", url: "/admin/tokens", needs: "admin", marks: [MARK.token] },
  { file: "audit/page.tsx", url: "/admin/audit", needs: "admin", marks: [MARK.audit] },
];

/** Accounts: mallory (plain author), victim, rev (reviewer), boss (admin). */
export async function seedAdminData(): Promise<void> {
  const { db } = await import("@/lib/db/client");
  const schema = await import("@/lib/db/schema");
  const { reserveExtension } = await import("@/lib/publishing/submit");
  const { report, createAdvisory, rate } = await import("@/lib/community");
  const { proposeTextChange } = await import("@/lib/lifecycle");

  await db.insert(schema.authors).values([
    { id: "mallory", githubId: 5001, githubLogin: "mallory", displayName: "Mallory" },
    { id: "victim", githubId: 5002, githubLogin: "victim", displayName: "Victim" },
    { id: "rev", githubId: 5003, githubLogin: "rev", displayName: "Rev", role: "reviewer" },
    { id: "boss", githubId: 5004, githubLogin: "boss", displayName: "Boss", role: "admin" },
    { id: "ghost", githubId: 5005, githubLogin: MARK.account, displayName: "Ghost" },
  ]);
  // A listed extension with a report, a draft advisory, a hidden rating and a pending text change.
  const listed = reserveExtension("victim", { slug: "listed-plugin", name: "Listed", description: "d", type: "plugin", pluginType: "hook", host: "github.com", repo: "victim/listed", subpath: "" });
  db.update(schema.extensions).set({ status: "approved" }).run();
  await report(listed, { reason: "malware", details: MARK.reportText, contactEmail: MARK.reporter, ipHash: "ip" }, () => []);
  await createAdvisory(listed, { affected: "<=1.0.0", severity: "high", summary: MARK.draft, details: "not public yet", publish: false }, { kind: "admin", id: "boss" });
  await proposeTextChange(listed, "long_description", MARK.pendingText, null, { kind: "author", id: "victim" });
  await rate({ ...listed, status: "approved" }, "mallory", 1, MARK.rating);
  db.update(schema.ratings).set({ hiddenAt: new Date(), hiddenBy: "boss" }).run();
  // Someone else's unreleased plugin, waiting for review.
  const pending = reserveExtension("victim", { slug: MARK.queued, name: MARK.queued, description: "d", type: "plugin", pluginType: "hook", host: "github.com", repo: "victim/secret", subpath: "" });
  await db.insert(schema.submissions).values({
    id: SUB_ID, extensionId: pending.id, authorId: "victim", type: "new_extension", githubRepo: "victim/secret", githubTag: "v1.0.0", subpath: "",
    sourceHost: "github.com", sourceCommit: "a".repeat(40), slug: MARK.queued, version: "1.0.0", status: "awaiting_review", dryRun: false,
    submittedVia: "web", manifestSnapshot: { id: MARK.queued, note: MARK.manifest }, buildLog: MARK.buildLog,
  });
  // An API token and an audit entry, for the admin-only pages.
  await db.insert(schema.apiTokens).values({
    id: crypto.randomUUID(), authorId: "victim", name: MARK.token, prefix: "bwx_fake0001", secretHash: "0".repeat(64), scopes: ["read"], expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db.insert(schema.auditLog).values({ at: new Date(), actorKind: "admin", actorId: "boss", action: MARK.audit, targetKind: "extension", targetId: listed.id });
}
