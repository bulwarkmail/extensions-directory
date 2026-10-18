-- Organization owners. Adds the author kind and org_members, creates the
-- Bulwark organization (GitHub org bulwarkmail), moves the extensions of
-- rathlinus to it, and reserves the official plugins from bulwarkmail/plugins
-- that aren't listed yet, each with a trusted publisher for that repository's
-- publish workflow. Only adds; every data step checks the rows it needs, so on
-- a database without rathlinus only the organization row is created.
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
	VALUES ('e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4', 266882946, 'bulwarkmail', 'Bulwark', 'https://avatars.githubusercontent.com/u/266882946?v=4', 'https://bulwarkmail.org', 1, 0, unixepoch(), unixepoch(), 'author', 0, 'org');--> statement-breakpoint
-- rathlinus (Linus Rath) owns the organization.
INSERT OR IGNORE INTO `org_members` (`org_id`, `author_id`, `role`, `added_by`, `created_at`)
	SELECT 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4', `id`, 'owner', `id`, unixepoch() FROM `authors`
	WHERE `id` = 'b99d8e35-0a4a-49da-b768-689c7125bd3c' AND EXISTS (SELECT 1 FROM `authors` WHERE `id` = 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4' AND `kind` = 'org');--> statement-breakpoint
-- His extensions move to the organization; he stays an owner of each.
INSERT OR IGNORE INTO `extension_members` (`extension_id`, `author_id`, `role`, `added_by`, `created_at`)
	SELECT `id`, `author_id`, 'owner', `author_id`, unixepoch() FROM `extensions`
	WHERE `author_id` = 'b99d8e35-0a4a-49da-b768-689c7125bd3c' AND EXISTS (SELECT 1 FROM `authors` WHERE `id` = 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4' AND `kind` = 'org');--> statement-breakpoint
UPDATE `extensions` SET `author_id` = 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4'
	WHERE `author_id` = 'b99d8e35-0a4a-49da-b768-689c7125bd3c' AND EXISTS (SELECT 1 FROM `authors` WHERE `id` = 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4' AND `kind` = 'org');--> statement-breakpoint
-- Two monorepo plugins were listed without their folder.
UPDATE `extensions` SET `subpath` = `slug`
	WHERE `slug` IN ('jitsi-meet', 'quick-notes') AND `subpath` = '' AND lower(`github_repo`) = 'bulwarkmail/plugins';--> statement-breakpoint
-- Reserve the official plugins that aren't listed yet (name, description and
-- type from each folder's manifest.json on bulwarkmail/plugins main).
INSERT INTO `extensions` (`id`, `slug`, `name`, `type`, `plugin_type`, `author_id`, `description`, `github_repo`, `subpath`, `source_host`, `status`, `reserved_at`, `created_at`, `updated_at`)
	SELECT lower(hex(randomblob(16))), r.`slug`, r.`name`, 'plugin', r.`plugin_type`, 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4', r.`description`, 'bulwarkmail/plugins', r.`slug`, 'github.com', 'pending', unixepoch(), unixepoch(), unixepoch()
	FROM (SELECT column1 AS `slug`, column2 AS `name`, column3 AS `description`, column4 AS `plugin_type` FROM (VALUES
		('ai-assistant', 'AI Writing Assistant', 'Write, rewrite, translate and proofread emails, and summarise messages, with an OpenAI-compatible service (OpenAI, Ollama, ...) or Anthropic. Text is only sent when you click.', 'ui-extension'),
		('auto-tag', 'Auto Tag', 'Automatically tags incoming emails based on configurable rules', 'hook'),
		('birthdays', 'Birthday reminders', 'Upcoming birthdays from your contacts in the sidebar, reminders on the day and a few days before, a quick birthday greeting and, if you like, birthday events in your calendar.', 'sidebar-app'),
		('email-stats', 'Email Stats', 'Sidebar section showing email activity statistics', 'sidebar-app'),
		('email-to-task', 'Email to task', 'Turn a message into a task in Bulwark''s own tasks, Vikunja, Todoist or a CalDAV task list, with a link back to the message and a due date taken from the text.', 'ui-extension'),
		('nextcloud', 'Nextcloud', 'Connect your Nextcloud: attach files from it, send large files as share links, and save attachments and messages to it. You sign in through Nextcloud itself; the app password stays on the webmail server.', 'ui-extension'),
		('outlook-style-headers', 'Outlook-style Quote Headers', 'Replaces the default reply/forward quote header with an Outlook-style From / Sent / To / Cc / Subject block. The original message follows directly, with no blockquote indent.', 'hook'),
		('paperless', 'Paperless-ngx', 'Send attachments and messages to Paperless-ngx, find your documents there and attach them to new mail.', 'ui-extension'),
		('parcels', 'Package tracking', 'Finds tracking numbers in your mail, shows where each parcel is and tells you when its status changes.', 'ui-extension'),
		('reply-all-guardrail', 'Reply-All Guardrail', 'Asks for confirmation before reply-all (and optionally before any send) when the recipient count crosses a threshold. Catches accidental fan-outs on large threads.', 'hook'),
		('timezones', 'Time zone helper', 'Shows the time where the people you write to are: participants'' local times in the event form, the sender''s local time in a message, a time in several zones for the composer and an optional world clock.', 'ui-extension'),
		('translate', 'Translate', 'Translate received emails into your preferred language using a free public translation API (MyMemory by default, LibreTranslate optional).', 'ui-extension')
	)) r
	WHERE NOT EXISTS (SELECT 1 FROM `extensions` e WHERE e.`slug` = r.`slug`)
		AND EXISTS (SELECT 1 FROM `org_members` m WHERE m.`org_id` = 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4' AND m.`author_id` = 'b99d8e35-0a4a-49da-b768-689c7125bd3c');--> statement-breakpoint
INSERT OR IGNORE INTO `extension_members` (`extension_id`, `author_id`, `role`, `added_by`, `created_at`)
	SELECT e.`id`, m.`author_id`, 'owner', m.`author_id`, unixepoch() FROM `extensions` e
	JOIN `org_members` m ON m.`org_id` = e.`author_id` AND m.`author_id` = 'b99d8e35-0a4a-49da-b768-689c7125bd3c'
	WHERE e.`author_id` = 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4' AND e.`slug` IN ('ai-assistant', 'auto-tag', 'birthdays', 'email-stats', 'email-to-task', 'nextcloud',
		'outlook-style-headers', 'paperless', 'parcels', 'reply-all-guardrail', 'timezones', 'translate');--> statement-breakpoint
-- Trusted publishers: the plugins repository's publish workflow may submit
-- every organization extension that lives in it. external-recipient-warning
-- is built from the same folder as external-mail-warning, and the matcher
-- refuses two publishers for one folder, so it gets none.
INSERT INTO `publishers` (`id`, `extension_id`, `provider`, `repository`, `repository_id`, `repository_owner_id`, `workflow_path`, `environment`, `subpath`, `allowed_refs`, `created_by`, `created_at`)
	SELECT lower(hex(randomblob(16))), e.`id`, 'github', 'bulwarkmail/plugins', '1191052237', '266882946', '.github/workflows/publish.yml', 'extensions', e.`subpath`, 'tags', m.`author_id`, unixepoch()
	FROM `extensions` e
	JOIN `org_members` m ON m.`org_id` = e.`author_id` AND m.`author_id` = 'b99d8e35-0a4a-49da-b768-689c7125bd3c'
	WHERE e.`author_id` = 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4' AND lower(e.`github_repo`) = 'bulwarkmail/plugins' AND e.`subpath` <> ''
		AND e.`slug` <> 'external-recipient-warning'
		AND NOT EXISTS (SELECT 1 FROM `publishers` p WHERE p.`repository_id` = '1191052237' AND p.`workflow_path` = '.github/workflows/publish.yml' AND p.`subpath` = e.`subpath`);
