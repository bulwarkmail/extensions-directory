import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

const uuid = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const uuidCol = (name: string) => text(name);
const timestamp = (name: string) =>
  integer(name, { mode: "timestamp" }).$defaultFn(() => new Date());

// Authors (linked to GitHub accounts)
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
  banned: integer("banned", { mode: "boolean" }).default(false),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// Directory Admins (site reviewers/moderators)
export const directoryAdmins = sqliteTable("directory_admins", {
  id: uuid(),
  githubId: integer("github_id").unique().notNull(),
  githubLogin: text("github_login").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["reviewer", "admin", "super_admin"] })
    .notNull()
    .default("reviewer"),
  createdAt: timestamp("created_at"),
});

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
    githubRepo: text("github_repo").notNull(),
    // Subdirectory inside the repo (for monorepos). Empty for single-extension
    // repos with manifest at the root. Used as the default for update
    // submissions; authors and admins can edit it.
    subpath: text("subpath").notNull().default(""),
    license: text("license").notNull().default("MIT"),
    iconPath: text("icon_path"),
    bannerPath: text("banner_path"),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "suspended", "archived"],
    })
      .notNull()
      .default("pending"),
    featured: integer("featured", { mode: "boolean" }).default(false),
    // Stored as JSON text since SQLite has no array type
    permissions: text("permissions", { mode: "json" }).$type<string[]>().default([]),
    tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
    minAppVersion: text("min_app_version"),
    totalDownloads: integer("total_downloads").default(0),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("idx_extensions_type").on(table.type),
    index("idx_extensions_status").on(table.status),
    index("idx_extensions_slug").on(table.slug),
    index("idx_extensions_author").on(table.authorId),
  ]
);

// Extension Versions
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
    permissions: text("permissions", { mode: "json" }).$type<string[]>().default([]),
    minAppVersion: text("min_app_version"),
    manifest: text("manifest", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    scanStatus: text("scan_status", {
      enum: ["pending", "scanning", "clean", "flagged", "failed"],
    })
      .notNull()
      .default("pending"),
    scanReport: text("scan_report", { mode: "json" }).$type<Record<string, unknown>>(),
    reviewStatus: text("review_status", {
      enum: ["pending", "approved", "rejected"],
    })
      .notNull()
      .default("pending"),
    reviewerId: uuidCol("reviewer_id").references(() => directoryAdmins.id),
    reviewNotes: text("review_notes"),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    createdAt: timestamp("created_at"),
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
    colors: text("colors", { mode: "json" }).$type<Record<string, string>>(),
  },
  (table) => [
    uniqueIndex("idx_theme_preview_unique").on(
      table.extensionId,
      table.variant
    ),
  ]
);

// Download Stats
export const downloadStats = sqliteTable("download_stats", {
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
});

// Submissions / Review Queue
export const submissions = sqliteTable("submissions", {
  id: uuid(),
  extensionId: uuidCol("extension_id").references(() => extensions.id),
  versionId: uuidCol("version_id").references(() => extensionVersions.id),
  authorId: uuidCol("author_id")
    .notNull()
    .references(() => authors.id),
  type: text("type", { enum: ["new_extension", "new_version"] }).notNull(),
  githubRepo: text("github_repo").notNull(),
  githubTag: text("github_tag").notNull(),
  // Subdirectory inside the repo (for monorepos like bulwarkmail/plugins).
  // Empty string for single-extension repos with manifest at the root.
  subpath: text("subpath").notNull().default(""),
  // Snapshot of the manifest at submission time, used by the approval pipeline.
  manifestSnapshot: text("manifest_snapshot", { mode: "json" }).$type<Record<string, unknown>>(),
  status: text("status", {
    enum: ["pending", "scanning", "review", "approved", "rejected"],
  })
    .notNull()
    .default("pending"),
  scanReport: text("scan_report", { mode: "json" }).$type<Record<string, unknown>>(),
  reviewerId: uuidCol("reviewer_id").references(() => directoryAdmins.id),
  reviewNotes: text("review_notes"),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
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
