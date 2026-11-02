-- Reserve the new official plugin languagetool from bulwarkmail/plugins for the
-- Bulwark organization, with rathlinus as its owner and a trusted publisher for
-- the plugins repository's publish workflow, like 0004 did for the others.
-- Only adds, and only when the slug is free and the organization is set up.
INSERT INTO `extensions` (`id`, `slug`, `name`, `type`, `plugin_type`, `author_id`, `description`, `github_repo`, `subpath`, `source_host`, `license`, `status`, `reserved_at`, `created_at`, `updated_at`)
	SELECT lower(hex(randomblob(16))), 'languagetool', 'Proofreading (LanguageTool)', 'plugin', 'ui-extension', 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4',
		'Underlines spelling, grammar and style mistakes while you write, with suggestions to fix them. Sends the text you write to the LanguageTool server your administrator set up (self-hosted, or the public api.languagetool.org only if the administrator allows it). Nothing is sent while a message is set to be signed or encrypted.',
		'bulwarkmail/plugins', 'languagetool', 'github.com', 'AGPL-3.0', 'pending', unixepoch(), unixepoch(), unixepoch()
	WHERE NOT EXISTS (SELECT 1 FROM `extensions` WHERE `slug` = 'languagetool')
		AND EXISTS (SELECT 1 FROM `org_members` WHERE `org_id` = 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4' AND `author_id` = 'b99d8e35-0a4a-49da-b768-689c7125bd3c');--> statement-breakpoint
INSERT OR IGNORE INTO `extension_members` (`extension_id`, `author_id`, `role`, `added_by`, `created_at`)
	SELECT e.`id`, m.`author_id`, 'owner', m.`author_id`, unixepoch() FROM `extensions` e
	JOIN `org_members` m ON m.`org_id` = e.`author_id` AND m.`author_id` = 'b99d8e35-0a4a-49da-b768-689c7125bd3c'
	WHERE e.`author_id` = 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4' AND e.`slug` = 'languagetool';--> statement-breakpoint
INSERT INTO `publishers` (`id`, `extension_id`, `provider`, `repository`, `repository_id`, `repository_owner_id`, `workflow_path`, `environment`, `subpath`, `allowed_refs`, `created_by`, `created_at`)
	SELECT lower(hex(randomblob(16))), e.`id`, 'github', 'bulwarkmail/plugins', '1191052237', '266882946', '.github/workflows/publish.yml', 'extensions', 'languagetool', 'tags', m.`author_id`, unixepoch()
	FROM `extensions` e
	JOIN `org_members` m ON m.`org_id` = e.`author_id` AND m.`author_id` = 'b99d8e35-0a4a-49da-b768-689c7125bd3c'
	WHERE e.`author_id` = 'e1a8f4a1-9b4e-4568-afb7-d7e1cdf6afa4' AND e.`slug` = 'languagetool' AND lower(e.`github_repo`) = 'bulwarkmail/plugins'
		AND NOT EXISTS (SELECT 1 FROM `publishers` p WHERE p.`repository_id` = '1191052237' AND p.`workflow_path` = '.github/workflows/publish.yml' AND p.`subpath` = 'languagetool');
