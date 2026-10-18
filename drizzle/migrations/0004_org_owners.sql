-- Organization owners. Adds the author kind and org_members, and creates the
-- Bulwark organization (GitHub org bulwarkmail).
ALTER TABLE `authors` ADD `kind` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE TABLE `org_members` (
	`org_id` text NOT NULL,
	`author_id` text NOT NULL,
	`role` text NOT NULL,
	`added_by` text,
	`created_at` integer,
	PRIMARY KEY(`org_id`, `author_id`),
	FOREIGN KEY (`org_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_org_members_author` ON `org_members` (`author_id`);--> statement-breakpoint
-- The organization. Fixed id; GitHub id 266882946 is the bulwarkmail org.
INSERT OR IGNORE INTO `authors` (`id`, `github_id`, `github_login`, `display_name`, `avatar_url`, `website`, `verified`, `banned`, `created_at`, `updated_at`, `role`, `notify_email`, `kind`)
	VALUES ('e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4', 266882946, 'bulwarkmail', 'Bulwark', 'https://avatars.githubusercontent.com/u/266882946?v=4', 'https://bulwarkmail.org', 1, 0, unixepoch(), unixepoch(), 'author', 0, 'org');
