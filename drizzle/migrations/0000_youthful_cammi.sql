CREATE TABLE `authors` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` integer NOT NULL,
	`github_login` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`email` text,
	`bio` text,
	`website` text,
	`verified` integer DEFAULT false,
	`banned` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authors_github_id_unique` ON `authors` (`github_id`);--> statement-breakpoint
CREATE TABLE `directory_admins` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` integer NOT NULL,
	`github_login` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'reviewer' NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `directory_admins_github_id_unique` ON `directory_admins` (`github_id`);--> statement-breakpoint
CREATE TABLE `download_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`version_id` text NOT NULL,
	`downloaded_at` integer,
	`user_agent` text,
	`ip_hash` text,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `extension_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `extension_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`version` text NOT NULL,
	`changelog` text,
	`bundle_path` text NOT NULL,
	`bundle_sha256` text NOT NULL,
	`bundle_size` integer NOT NULL,
	`permissions` text DEFAULT '[]',
	`min_app_version` text,
	`manifest` text NOT NULL,
	`scan_status` text DEFAULT 'pending' NOT NULL,
	`scan_report` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`reviewer_id` text,
	`review_notes` text,
	`published_at` integer,
	`created_at` integer,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_id`) REFERENCES `directory_admins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ext_version_unique` ON `extension_versions` (`extension_id`,`version`);--> statement-breakpoint
CREATE TABLE `extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`plugin_type` text,
	`author_id` text NOT NULL,
	`description` text NOT NULL,
	`long_description` text,
	`github_repo` text NOT NULL,
	`license` text DEFAULT 'MIT' NOT NULL,
	`icon_path` text,
	`banner_path` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`featured` integer DEFAULT false,
	`permissions` text DEFAULT '[]',
	`tags` text DEFAULT '[]',
	`min_app_version` text,
	`total_downloads` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extensions_slug_unique` ON `extensions` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_extensions_type` ON `extensions` (`type`);--> statement-breakpoint
CREATE INDEX `idx_extensions_status` ON `extensions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_extensions_slug` ON `extensions` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_extensions_author` ON `extensions` (`author_id`);--> statement-breakpoint
CREATE TABLE `screenshots` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`path` text NOT NULL,
	`alt_text` text,
	`sort_order` integer DEFAULT 0,
	`created_at` integer,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text,
	`version_id` text,
	`author_id` text NOT NULL,
	`type` text NOT NULL,
	`github_repo` text NOT NULL,
	`github_tag` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scan_report` text,
	`reviewer_id` text,
	`review_notes` text,
	`submitted_at` integer,
	`reviewed_at` integer,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `extension_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `directory_admins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `theme_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`variant` text NOT NULL,
	`preview_path` text NOT NULL,
	`colors` text,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_theme_preview_unique` ON `theme_previews` (`extension_id`,`variant`);