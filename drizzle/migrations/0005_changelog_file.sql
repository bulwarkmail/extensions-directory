-- Changelogs from CHANGELOG.md. A submission remembers where its notes came
-- from (the folder's CHANGELOG.md, the tag's release or manifest.json), and a
-- published version's changelog_source can now be 'file'. Only adds a column;
-- older submissions keep NULL and are published as before.
ALTER TABLE `submissions` ADD `release_notes_source` text;
