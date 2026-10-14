import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// The tables from before the publishing rework keep their names, ids and
// columns; drizzle/migrations/0003_publishing.sql only adds to them. See
// docs/rework-plan.md, section 3.

const uuid = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const uuidCol = (name: string) => text(name);
const timestamp = (name: string) =>
  integer(name, { mode: "timestamp" }).$defaultFn(() => new Date());
const time = (name: string) => integer(name, { mode: "timestamp" });
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

export const ROLES = ["author", "reviewer", "admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

// Authors (linked to GitHub accounts). Also directory staff: `role`.
export const authors = sqliteTable("authors", {
  id: uuid(),
  githubId: integer("github_id").unique().notNull(),
  githubLogin: text("github_login").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  email: text("email"),
  bio: text("bio"),
  website: text("website"),
  verified: integer("verified", { mode: "boolean" }).default(false),
  // Kept in step with banned_at for releases from before the rework.
  banned: integer("banned", { mode: "boolean" }).default(false),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  role: text("role", { enum: ROLES }).notNull().default("author"),
  bannedAt: time("banned_at"),
  bannedReason: text("banned_reason"),
  bannedBy: uuidCol("banned_by"),
  // Bumped to end every session of this account.
  sessionEpoch: integer("session_epoch").notNull().default(0),
  notifyEmail: integer("notify_email", { mode: "boolean" }).notNull().default(true),
});

// Directory staff from before the rework. Their role now lives on
// authors.role; this table stays because review columns reference it.
export const directoryAdmins = sqliteTable("directory_admins", {
  id: uuid(),
  githubId: integer("github_id").unique().notNull(),
  githubLogin: text("github_login").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["reviewer", "admin", "super_admin"] })
    .notNull()
    .default("reviewer"),
  createdAt: timestamp("created_at"),
  authorId: uuidCol("author_id"),
});

export const EXTENSION_STATUSES = ["pending", "approved", "rejected", "suspended", "archived"] as const;
export const SOURCE_HOSTS = ["github.com", "gitlab.com", "codeberg.org"] as const;
export type SourceHost = (typeof SOURCE_HOSTS)[number];

// Extensions (plugins + themes)
export const extensions = sqliteTable(
  "extensions",
  {
    id: uuid(),
    slug: text("slug").unique().notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ["plugin", "theme"] }).notNull(),
    pluginType: text("plugin_type", {
      enum: ["hook", "ui-extension", "sidebar-app"],
    }),
    authorId: uuidCol("author_id")
      .notNull()
      .references(() => authors.id),
    description: text("description").notNull(),
    longDescription: text("long_description"),
    // owner/name on any host (group/subgroup/name on GitLab).
    githubRepo: text("github_repo").notNull(),
    subpath: text("subpath").notNull().default(""),
    license: text("license").notNull().default("MIT"),
    iconPath: text("icon_path"),
    bannerPath: text("banner_path"),
    status: text("status", { enum: EXTENSION_STATUSES }).notNull().default("pending"),
    featured: integer("featured", { mode: "boolean" }).default(false),
    permissions: json<string[]>("permissions").default([]),
    tags: json<string[]>("tags").default([]),
    minAppVersion: text("min_app_version"),
    totalDownloads: integer("total_downloads").default(0),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    sourceHost: text("source_host", { enum: SOURCE_HOSTS }).notNull().default("github.com"),
    // Numeric project id on the host, looked up when the source is set.
    sourceRepoId: text("source_repo_id"),
    deprecatedAt: time("deprecated_at"),
    deprecationMessage: text("deprecation_message"),
    replacementSlug: text("replacement_slug"),
    suspendedReason: text("suspended_reason"),
    latestStableVersionId: uuidCol("latest_stable_version_id"),
    latestBetaVersionId: uuidCol("latest_beta_version_id"),
    reservedAt: time("reserved_at"),
    reservationWarnedAt: time("reservation_warned_at"),
  },
  (table) => [
    index("idx_extensions_type").on(table.type),
    index("idx_extensions_status").on(table.status),
    index("idx_extensions_slug").on(table.slug),
    index("idx_extensions_author").on(table.authorId),
  ]
);

export const extensionMembers = sqliteTable(
  "extension_members",
  {
    extensionId: uuidCol("extension_id").notNull().references(() => extensions.id, { onDelete: "cascade" }),
    authorId: uuidCol("author_id").notNull().references(() => authors.id),
    role: text("role", { enum: ["owner", "maintainer"] }).notNull(),
    addedBy: uuidCol("added_by"),
    createdAt: timestamp("created_at"),
  },
  (t) => [primaryKey({ columns: [t.extensionId, t.authorId] }), index("idx_members_author").on(t.authorId)]
);

export const SUBMITTED_VIA = ["web", "oidc", "token", "legacy"] as const;

// Published versions. A row exists once a submission was approved; the
// bundle it points at never changes.
export const extensionVersions = sqliteTable(
  "extension_versions",
  {
    id: uuid(),
    extensionId: uuidCol("extension_id")
      .notNull()
      .references(() => extensions.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    changelog: text("changelog"),
    bundlePath: text("bundle_path").notNull(),
    bundleSha256: text("bundle_sha256").notNull(),
    bundleSize: integer("bundle_size").notNull(),
    permissions: json<string[]>("permissions").default([]),
    minAppVersion: text("min_app_version"),
    manifest: json<Record<string, unknown>>("manifest").notNull(),
    scanStatus: text("scan_status", {
      enum: ["pending", "scanning", "clean", "flagged", "failed"],
    })
      .notNull()
      .default("pending"),
    scanReport: json<Record<string, unknown>>("scan_report"),
    reviewStatus: text("review_status", {
      enum: ["pending", "approved", "rejected"],
    })
      .notNull()
      .default("pending"),
    reviewerId: uuidCol("reviewer_id").references(() => directoryAdmins.id),
    reviewNotes: text("review_notes"),
    publishedAt: time("published_at"),
    createdAt: timestamp("created_at"),
    channel: text("channel", { enum: ["stable", "beta"] }).notNull().default("stable"),
    maxAppVersion: text("max_app_version"),
    yankedAt: time("yanked_at"),
    yankedBy: uuidCol("yanked_by"),
    yankReason: text("yank_reason"),
    submissionId: uuidCol("submission_id"),
    reviewedBy: uuidCol("reviewed_by"),
    sourceHost: text("source_host"),
    sourceRepo: text("source_repo"),
    sourceCommit: text("source_commit"),
    sourceRef: text("source_ref"),
    sourceSubpath: text("source_subpath"),
    submittedVia: text("submitted_via", { enum: SUBMITTED_VIA }),
    submittedBy: uuidCol("submitted_by"),
    ciWorkflowRef: text("ci_workflow_ref"),
    ciRunId: text("ci_run_id"),
    ciRunAttempt: text("ci_run_attempt"),
    ciEvent: text("ci_event"),
    builderImage: text("builder_image"),
    buildSource: text("build_source"),
    provenance: json<Record<string, unknown>>("provenance"),
    signature: text("signature"),
    signingKeyId: text("signing_key_id"),
    signedStatement: text("signed_statement"),
    changelogSource: text("changelog_source", { enum: ["release", "manifest", "manual", "legacy"] }),
    downloadCount: integer("download_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("idx_ext_version_unique").on(
      table.extensionId,
      table.version
    ),
  ]
);

// Screenshots
export const screenshots = sqliteTable("screenshots", {
  id: uuid(),
  extensionId: uuidCol("extension_id")
    .notNull()
    .references(() => extensions.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  altText: text("alt_text"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at"),
});

// Theme Previews
export const themePreviews = sqliteTable(
  "theme_previews",
  {
    id: uuid(),
    extensionId: uuidCol("extension_id")
      .notNull()
      .references(() => extensions.id, { onDelete: "cascade" }),
    variant: text("variant", { enum: ["light", "dark"] }).notNull(),
    previewPath: text("preview_path").notNull(),
    colors: json<Record<string, string>>("colors"),
  },
  (table) => [
    uniqueIndex("idx_theme_preview_unique").on(
      table.extensionId,
      table.variant
    ),
  ]
);

// Raw downloads; rolled up into download_daily and pruned after 90 days.
export const downloadStats = sqliteTable(
  "download_stats",
  {
    id: uuid(),
    extensionId: uuidCol("extension_id")
      .notNull()
      .references(() => extensions.id, { onDelete: "cascade" }),
    versionId: uuidCol("version_id")
      .notNull()
      .references(() => extensionVersions.id, { onDelete: "cascade" }),
    downloadedAt: timestamp("downloaded_at"),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
  },
  (t) => [index("idx_downloads_version_ip").on(t.versionId, t.ipHash, t.downloadedAt)]
);

export const downloadDaily = sqliteTable(
  "download_daily",
  {
    versionId: uuidCol("version_id").notNull().references(() => extensionVersions.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.day] })]
);

export const SUBMISSION_STATUSES = [
  // From before the rework; migrated to queued.
  "pending", "scanning", "review",
  "queued", "building", "build_failed", "blocked", "awaiting_review",
  "publishing", "approved", "rejected", "withdrawn",
  "dry_run_passed", "dry_run_failed",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const OPEN_STATUSES: SubmissionStatus[] = ["queued", "building", "awaiting_review", "publishing"];

// A build-and-review job: one attempt at publishing a version (or a dry run).
export const submissions = sqliteTable(
  "submissions",
  {
    id: uuid(),
    extensionId: uuidCol("extension_id").references(() => extensions.id),
    versionId: uuidCol("version_id").references(() => extensionVersions.id),
    authorId: uuidCol("author_id")
      .notNull()
      .references(() => authors.id),
    type: text("type", { enum: ["new_extension", "new_version"] }).notNull(),
    githubRepo: text("github_repo").notNull(),
    // The ref as given (tag, branch or commit).
    githubTag: text("github_tag").notNull(),
    subpath: text("subpath").notNull().default(""),
    manifestSnapshot: json<Record<string, unknown>>("manifest_snapshot"),
    status: text("status", { enum: SUBMISSION_STATUSES }).notNull().default("queued"),
    scanReport: json<Record<string, unknown>>("scan_report"),
    reviewerId: uuidCol("reviewer_id").references(() => directoryAdmins.id),
    reviewNotes: text("review_notes"),
    submittedAt: timestamp("submitted_at"),
    reviewedAt: time("reviewed_at"),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(false),
    sourceHost: text("source_host").notNull().default("github.com"),
    sourceCommit: text("source_commit"),
    slug: text("slug"),
    version: text("version"),
    submittedVia: text("submitted_via", { enum: SUBMITTED_VIA }).notNull().default("web"),
    submittedByTokenId: uuidCol("submitted_by_token_id"),
    ciClaims: json<Record<string, unknown>>("ci_claims"),
    error: text("error"),
    buildLog: text("build_log"),
    buildSource: text("build_source"),
    builderImage: text("builder_image"),
    artifactPath: text("artifact_path"),
    artifactSha256: text("artifact_sha256"),
    artifactSize: integer("artifact_size"),
    media: json<StagedMedia>("media"),
    releaseNotes: text("release_notes"),
    diffSummary: json<Record<string, unknown>>("diff_summary"),
    compatReport: json<Record<string, unknown>>("compat_report"),
    attempts: integer("attempts").notNull().default(0),
    claimedAt: time("claimed_at"),
    finishedAt: time("finished_at"),
    reviewedBy: uuidCol("reviewed_by"),
    pollTokenHash: text("poll_token_hash"),
    pollTokenExpiresAt: time("poll_token_expires_at"),
  },
  (t) => [
    index("idx_submissions_status").on(t.status),
    index("idx_submissions_extension").on(t.extensionId),
  ]
);

export interface StagedMedia {
  icon?: string | null;
  banner?: string | null;
  screenshots?: string[];
  warnings?: string[];
}

// Trusted publishing: which CI workflow may submit versions of an extension.
export const publishers = sqliteTable(
  "publishers",
  {
    id: uuid(),
    extensionId: uuidCol("extension_id").notNull().references(() => extensions.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["github"] }).notNull().default("github"),
    repository: text("repository").notNull(),
    repositoryId: text("repository_id").notNull(),
    repositoryOwnerId: text("repository_owner_id").notNull(),
    workflowPath: text("workflow_path").notNull(),
    environment: text("environment"),
    subpath: text("subpath").notNull().default(""),
    allowedRefs: text("allowed_refs", { enum: ["tags", "any"] }).notNull().default("tags"),
    createdBy: uuidCol("created_by").notNull(),
    createdAt: timestamp("created_at"),
    lastUsedAt: time("last_used_at"),
    disabledAt: time("disabled_at"),
  },
  (t) => [index("idx_publishers_repo").on(t.repositoryId)]
);

export const oidcTokenUses = sqliteTable("oidc_token_uses", {
  jti: text("jti").primaryKey(),
  expiresAt: time("expires_at").notNull(),
});

export const TOKEN_SCOPES = ["publish", "dry_run", "read"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const apiTokens = sqliteTable("api_tokens", {
  id: uuid(),
  authorId: uuidCol("author_id").notNull().references(() => authors.id),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  scopes: json<TokenScope[]>("scopes").notNull(),
  expiresAt: time("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  lastUsedAt: time("last_used_at"),
  lastUsedIpHash: text("last_used_ip_hash"),
  revokedAt: time("revoked_at"),
  revokedBy: uuidCol("revoked_by"),
  revokedReason: text("revoked_reason"),
});

export const apiTokenExtensions = sqliteTable(
  "api_token_extensions",
  {
    tokenId: uuidCol("token_id").notNull().references(() => apiTokens.id, { onDelete: "cascade" }),
    extensionId: uuidCol("extension_id").notNull().references(() => extensions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.tokenId, t.extensionId] })]
);

export const signingKeys = sqliteTable("signing_keys", {
  keyId: text("key_id").primaryKey(),
  publicKey: text("public_key").notNull(),
  status: text("status", { enum: ["active", "retired", "revoked"] }).notNull(),
  notBefore: time("not_before").notNull(),
  notAfter: time("not_after"),
  createdAt: timestamp("created_at"),
});

// The keyring document signed by the offline root key (scripts/sign-keyring).
export const keyrings = sqliteTable("keyrings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  document: text("document").notNull(),
  createdAt: timestamp("created_at"),
});

export const notifications = sqliteTable("notifications", {
  id: uuid(),
  authorId: uuidCol("author_id").notNull().references(() => authors.id),
  kind: text("kind").notNull(),
  payload: json<Record<string, unknown>>("payload").notNull(),
  createdAt: timestamp("created_at"),
  sentAt: time("sent_at"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
});

export const webhooks = sqliteTable("webhooks", {
  id: uuid(),
  authorId: uuidCol("author_id").notNull().references(() => authors.id),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: json<string[]>("events").notNull(),
  createdAt: timestamp("created_at"),
  lastDeliveryAt: time("last_delivery_at"),
  lastStatus: text("last_status"),
  disabledAt: time("disabled_at"),
});

export const ratings = sqliteTable(
  "ratings",
  {
    id: uuid(),
    extensionId: uuidCol("extension_id").notNull().references(() => extensions.id, { onDelete: "cascade" }),
    authorId: uuidCol("author_id").notNull().references(() => authors.id),
    stars: integer("stars").notNull(),
    body: text("body"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    hiddenAt: time("hidden_at"),
    hiddenBy: uuidCol("hidden_by"),
  },
  (t) => [uniqueIndex("idx_ratings_unique").on(t.extensionId, t.authorId)]
);

export const REPORT_REASONS = ["malware", "privacy", "broken", "impersonation", "spam", "other"] as const;

export const reports = sqliteTable("reports", {
  id: uuid(),
  extensionId: uuidCol("extension_id").notNull().references(() => extensions.id, { onDelete: "cascade" }),
  version: text("version"),
  reporterId: uuidCol("reporter_id"),
  reporterIpHash: text("reporter_ip_hash"),
  contactEmail: text("contact_email"),
  reason: text("reason", { enum: REPORT_REASONS }).notNull(),
  details: text("details").notNull(),
  duplicates: integer("duplicates").notNull().default(0),
  status: text("status", { enum: ["open", "actioned", "dismissed"] }).notNull().default("open"),
  handledBy: uuidCol("handled_by"),
  handledAt: time("handled_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at"),
});

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export const advisories = sqliteTable("advisories", {
  id: text("id").primaryKey(),
  extensionId: uuidCol("extension_id").notNull().references(() => extensions.id, { onDelete: "cascade" }),
  affected: text("affected").notNull(),
  fixedIn: text("fixed_in"),
  severity: text("severity", { enum: SEVERITIES }).notNull(),
  summary: text("summary").notNull(),
  details: text("details").notNull().default(""),
  publishedAt: time("published_at"),
  updatedAt: timestamp("updated_at"),
  withdrawnAt: time("withdrawn_at"),
  createdBy: uuidCol("created_by").notNull(),
  createdAt: timestamp("created_at"),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: timestamp("at"),
    actorKind: text("actor_kind", { enum: ["admin", "author", "token", "oidc", "system", "anonymous"] }).notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetKind: text("target_kind"),
    targetId: text("target_id"),
    details: json<Record<string, unknown>>("details"),
    ipHash: text("ip_hash"),
  },
  (t) => [index("idx_audit_at").on(t.at), index("idx_audit_target").on(t.targetKind, t.targetId)]
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })]
);

export const TEXT_FIELDS = ["description", "long_description", "changelog", "deprecation_message", "tags"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

export const textChanges = sqliteTable("text_changes", {
  id: uuid(),
  extensionId: uuidCol("extension_id").notNull().references(() => extensions.id, { onDelete: "cascade" }),
  versionId: uuidCol("version_id"),
  field: text("field", { enum: TEXT_FIELDS }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  proposedBy: uuidCol("proposed_by").notNull(),
  proposedAt: timestamp("proposed_at"),
  status: text("status", { enum: ["pending", "approved", "rejected", "withdrawn"] }).notNull().default("pending"),
  reviewerId: uuidCol("reviewer_id"),
  reviewNotes: text("review_notes"),
  reviewedAt: time("reviewed_at"),
});

// Relations
export const authorsRelations = relations(authors, ({ many }) => ({
  extensions: many(extensions),
  submissions: many(submissions),
}));

export const extensionsRelations = relations(extensions, ({ one, many }) => ({
  author: one(authors, {
    fields: [extensions.authorId],
    references: [authors.id],
  }),
  versions: many(extensionVersions),
  screenshots: many(screenshots),
  themePreviews: many(themePreviews),
  downloadStats: many(downloadStats),
}));

export const extensionVersionsRelations = relations(
  extensionVersions,
  ({ one }) => ({
    extension: one(extensions, {
      fields: [extensionVersions.extensionId],
      references: [extensions.id],
    }),
    reviewer: one(directoryAdmins, {
      fields: [extensionVersions.reviewerId],
      references: [directoryAdmins.id],
    }),
  })
);

export const screenshotsRelations = relations(screenshots, ({ one }) => ({
  extension: one(extensions, {
    fields: [screenshots.extensionId],
    references: [extensions.id],
  }),
}));

export const themePreviewsRelations = relations(themePreviews, ({ one }) => ({
  extension: one(extensions, {
    fields: [themePreviews.extensionId],
    references: [extensions.id],
  }),
}));

export const downloadStatsRelations = relations(downloadStats, ({ one }) => ({
  extension: one(extensions, {
    fields: [downloadStats.extensionId],
    references: [extensions.id],
  }),
  version: one(extensionVersions, {
    fields: [downloadStats.versionId],
    references: [extensionVersions.id],
  }),
}));

export const submissionsRelations = relations(submissions, ({ one }) => ({
  extension: one(extensions, {
    fields: [submissions.extensionId],
    references: [extensions.id],
  }),
  version: one(extensionVersions, {
    fields: [submissions.versionId],
    references: [extensionVersions.id],
  }),
  author: one(authors, {
    fields: [submissions.authorId],
    references: [authors.id],
  }),
  reviewer: one(directoryAdmins, {
    fields: [submissions.reviewerId],
    references: [directoryAdmins.id],
  }),
}));
