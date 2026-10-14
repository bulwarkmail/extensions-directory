-- The publishing rework (docs/rework-plan.md, section 14). Only adds columns,
-- tables and indexes and fills them in; nothing is dropped or rebuilt, so the
-- release before this one still runs against the result.
ALTER TABLE `authors` ADD `role` text DEFAULT 'author' NOT NULL;--> statement-breakpoint
ALTER TABLE `authors` ADD `banned_at` integer;--> statement-breakpoint
ALTER TABLE `authors` ADD `banned_reason` text;--> statement-breakpoint
ALTER TABLE `authors` ADD `banned_by` text;--> statement-breakpoint
ALTER TABLE `authors` ADD `session_epoch` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `authors` ADD `notify_email` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_admins` ADD `author_id` text;--> statement-breakpoint
ALTER TABLE `extensions` ADD `source_host` text DEFAULT 'github.com' NOT NULL;--> statement-breakpoint
ALTER TABLE `extensions` ADD `source_repo_id` text;--> statement-breakpoint
ALTER TABLE `extensions` ADD `deprecated_at` integer;--> statement-breakpoint
ALTER TABLE `extensions` ADD `deprecation_message` text;--> statement-breakpoint
ALTER TABLE `extensions` ADD `replacement_slug` text;--> statement-breakpoint
ALTER TABLE `extensions` ADD `suspended_reason` text;--> statement-breakpoint
ALTER TABLE `extensions` ADD `latest_stable_version_id` text;--> statement-breakpoint
ALTER TABLE `extensions` ADD `latest_beta_version_id` text;--> statement-breakpoint
ALTER TABLE `extensions` ADD `reserved_at` integer;--> statement-breakpoint
ALTER TABLE `extensions` ADD `reservation_warned_at` integer;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `channel` text DEFAULT 'stable' NOT NULL;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `max_app_version` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `yanked_at` integer;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `yanked_by` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `yank_reason` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `submission_id` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `reviewed_by` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `source_host` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `source_repo` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `source_commit` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `source_ref` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `source_subpath` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `submitted_via` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `submitted_by` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `ci_workflow_ref` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `ci_run_id` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `ci_run_attempt` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `ci_event` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `builder_image` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `build_source` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `provenance` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `signature` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `signing_key_id` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `signed_statement` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `changelog_source` text;--> statement-breakpoint
ALTER TABLE `extension_versions` ADD `download_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `dry_run` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `source_host` text DEFAULT 'github.com' NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `source_commit` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `version` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `submitted_via` text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `submitted_by_token_id` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `ci_claims` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `error` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `build_log` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `build_source` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `builder_image` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `artifact_path` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `artifact_sha256` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `artifact_size` integer;--> statement-breakpoint
ALTER TABLE `submissions` ADD `media` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `release_notes` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `diff_summary` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `compat_report` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `claimed_at` integer;--> statement-breakpoint
ALTER TABLE `submissions` ADD `finished_at` integer;--> statement-breakpoint
ALTER TABLE `submissions` ADD `reviewed_by` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `poll_token_hash` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `poll_token_expires_at` integer;--> statement-breakpoint
CREATE INDEX `idx_submissions_status` ON `submissions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_submissions_extension` ON `submissions` (`extension_id`);--> statement-breakpoint
CREATE INDEX `idx_downloads_version_ip` ON `download_stats` (`version_id`,`ip_hash`,`downloaded_at`);--> statement-breakpoint
CREATE TABLE `extension_members` (
	`extension_id` text NOT NULL,
	`author_id` text NOT NULL,
	`role` text NOT NULL,
	`added_by` text,
	`created_at` integer,
	PRIMARY KEY(`extension_id`, `author_id`),
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_members_author` ON `extension_members` (`author_id`);--> statement-breakpoint
CREATE TABLE `download_daily` (
	`version_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`version_id`, `day`),
	FOREIGN KEY (`version_id`) REFERENCES `extension_versions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `publishers` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`provider` text DEFAULT 'github' NOT NULL,
	`repository` text NOT NULL,
	`repository_id` text NOT NULL,
	`repository_owner_id` text NOT NULL,
	`workflow_path` text NOT NULL,
	`environment` text,
	`subpath` text DEFAULT '' NOT NULL,
	`allowed_refs` text DEFAULT 'tags' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer,
	`last_used_at` integer,
	`disabled_at` integer,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_publishers_repo` ON `publishers` (`repository_id`);--> statement-breakpoint
CREATE TABLE `oidc_token_uses` (
	`jti` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`secret_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`last_used_at` integer,
	`last_used_ip_hash` text,
	`revoked_at` integer,
	`revoked_by` text,
	`revoked_reason` text,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_prefix_unique` ON `api_tokens` (`prefix`);--> statement-breakpoint
CREATE TABLE `api_token_extensions` (
	`token_id` text NOT NULL,
	`extension_id` text NOT NULL,
	PRIMARY KEY(`token_id`, `extension_id`),
	FOREIGN KEY (`token_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `signing_keys` (
	`key_id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`status` text NOT NULL,
	`not_before` integer NOT NULL,
	`not_after` integer,
	`created_at` integer
);--> statement-breakpoint
CREATE TABLE `keyrings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document` text NOT NULL,
	`created_at` integer
);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer,
	`sent_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`created_at` integer,
	`last_delivery_at` integer,
	`last_status` text,
	`disabled_at` integer,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`author_id` text NOT NULL,
	`stars` integer NOT NULL,
	`body` text,
	`created_at` integer,
	`updated_at` integer,
	`hidden_at` integer,
	`hidden_by` text,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ratings_unique` ON `ratings` (`extension_id`,`author_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`version` text,
	`reporter_id` text,
	`reporter_ip_hash` text,
	`contact_email` text,
	`reason` text NOT NULL,
	`details` text NOT NULL,
	`duplicates` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`handled_by` text,
	`handled_at` integer,
	`notes` text,
	`created_at` integer,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `advisories` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`affected` text NOT NULL,
	`fixed_in` text,
	`severity` text NOT NULL,
	`summary` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`published_at` integer,
	`updated_at` integer,
	`withdrawn_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer,
	`actor_kind` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_kind` text,
	`target_id` text,
	`details` text,
	`ip_hash` text
);--> statement-breakpoint
CREATE INDEX `idx_audit_at` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `idx_audit_target` ON `audit_log` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window_start`)
);--> statement-breakpoint
CREATE TABLE `text_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`version_id` text,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`proposed_by` text NOT NULL,
	`proposed_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewer_id` text,
	`review_notes` text,
	`reviewed_at` integer,
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
-- Backfills.
-- Staff: the role moves onto the author row (created when missing).
INSERT INTO `authors` (`id`, `github_id`, `github_login`, `display_name`, `created_at`, `updated_at`)
	SELECT lower(hex(randomblob(16))), d.`github_id`, d.`github_login`, d.`display_name`, d.`created_at`, d.`created_at`
	FROM `directory_admins` d WHERE NOT EXISTS (SELECT 1 FROM `authors` a WHERE a.`github_id` = d.`github_id`);--> statement-breakpoint
UPDATE `directory_admins` SET `author_id` = (SELECT a.`id` FROM `authors` a WHERE a.`github_id` = `directory_admins`.`github_id`);--> statement-breakpoint
UPDATE `authors` SET `role` = (SELECT d.`role` FROM `directory_admins` d WHERE d.`github_id` = `authors`.`github_id`)
	WHERE EXISTS (SELECT 1 FROM `directory_admins` d WHERE d.`github_id` = `authors`.`github_id`);--> statement-breakpoint
UPDATE `authors` SET `banned_at` = coalesce(`updated_at`, `created_at`, unixepoch()) WHERE `banned` = 1;--> statement-breakpoint
-- Owners.
INSERT INTO `extension_members` (`extension_id`, `author_id`, `role`, `created_at`)
	SELECT `id`, `author_id`, 'owner', `created_at` FROM `extensions`;--> statement-breakpoint
UPDATE `extensions` SET `reserved_at` = `created_at` WHERE `status` = 'pending';--> statement-breakpoint
-- Versions: channel, where they came from, download counts.
UPDATE `extension_versions` SET `channel` = 'beta' WHERE instr(`version`, '-') > 0;--> statement-breakpoint
UPDATE `extension_versions` SET
	`submission_id` = (SELECT s.`id` FROM `submissions` s WHERE s.`version_id` = `extension_versions`.`id`),
	`source_host` = 'github.com',
	`source_repo` = (SELECT s.`github_repo` FROM `submissions` s WHERE s.`version_id` = `extension_versions`.`id`),
	`source_ref` = (SELECT s.`github_tag` FROM `submissions` s WHERE s.`version_id` = `extension_versions`.`id`),
	`source_subpath` = (SELECT s.`subpath` FROM `submissions` s WHERE s.`version_id` = `extension_versions`.`id`),
	`submitted_by` = (SELECT s.`author_id` FROM `submissions` s WHERE s.`version_id` = `extension_versions`.`id`),
	`submitted_via` = 'legacy',
	`changelog_source` = CASE WHEN `changelog` IS NULL THEN NULL ELSE 'legacy' END,
	`download_count` = (SELECT count(*) FROM `download_stats` d WHERE d.`version_id` = `extension_versions`.`id`);--> statement-breakpoint
UPDATE `extension_versions` SET `reviewed_by` = (SELECT d.`author_id` FROM `directory_admins` d WHERE d.`id` = `extension_versions`.`reviewer_id`) WHERE `reviewer_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `download_daily` (`version_id`, `day`, `count`)
	SELECT `version_id`, strftime('%Y-%m-%d', `downloaded_at`, 'unixepoch'), count(*)
	FROM `download_stats` WHERE `downloaded_at` IS NOT NULL GROUP BY 1, 2;--> statement-breakpoint
-- Submissions: what they were for, and open ones back into the queue.
UPDATE `submissions` SET
	`slug` = json_extract(`manifest_snapshot`, '$.id'),
	`version` = json_extract(`manifest_snapshot`, '$.version'),
	`submitted_via` = 'legacy';--> statement-breakpoint
UPDATE `submissions` SET `reviewed_by` = (SELECT d.`author_id` FROM `directory_admins` d WHERE d.`id` = `submissions`.`reviewer_id`) WHERE `reviewer_id` IS NOT NULL;--> statement-breakpoint
UPDATE `submissions` SET `status` = 'queued' WHERE `status` IN ('pending', 'scanning', 'review');--> statement-breakpoint
-- At most one open submission per extension and version: keep the newest.
UPDATE `submissions` SET `status` = 'withdrawn', `error` = 'Superseded by a newer submission of the same version'
	WHERE `status` = 'queued' AND `extension_id` IS NOT NULL AND EXISTS (
		SELECT 1 FROM `submissions` n WHERE n.`extension_id` = `submissions`.`extension_id` AND n.`version` = `submissions`.`version`
		AND n.`status` = 'queued' AND n.`submitted_at` > `submissions`.`submitted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_submissions_open_version` ON `submissions` (`extension_id`,`version`) WHERE `status` IN ('queued','building','awaiting_review','publishing') AND `dry_run` = 0;
