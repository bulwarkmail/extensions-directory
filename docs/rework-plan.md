# Extension directory rework

Status: draft for review, 2026-10-14. Nothing in here is built yet.

This is the plan for rewriting extensions.bulwarkmail.org around a publishing
API, so an author's CI can submit a new version without anyone clicking
through the site. Every submission still goes to a human reviewer. The
existing data (authors, extensions, versions, download counts, screenshots,
files) moves over unchanged, and the routes deployed webmails call keep
answering under /api/v1 with the same shapes.

Sections: what exists today, decisions, data model, review states, API, auth
flows, the build pipeline, signing and provenance, release lifecycle, author
tooling, users and admins, webmail changes, migration, tests, threat model,
phases, decisions from review, what's still open.

## 1. What exists today

Read from the code on `main` (6a99258) and the webmail on `main` (bcd044f4f).

Directory:

- Next.js 16 standalone, SQLite through better-sqlite3 and drizzle, three
  migrations (0000-0002). One pm2 process on mail.rath.li, port 3004, behind
  nginx. Deploys back up the database and run `deploy/migrate.cjs`.
- Authors sign in with GitHub OAuth (scope `read:user user:email`). Admins
  are rows in `directory_admins` matched by GitHub id at sign-in, which also
  sets a second iron-session cookie.
- `POST /api/v1/submissions` resolves the ref to a commit, fetches the
  manifest at that commit, downloads the zipball, resolves the bundle
  (prebuilt `<slug>.zip`, flat files, `dist/`, `build/`, or a Docker build
  when package.json has a build script), scans it and stores a submission
  row. The built files are thrown away.
- On approval, `lib/manifest.ts buildAndStoreBundle` downloads the archive
  again **by the stored ref, not the commit**, builds again, stores
  `bundles/<slug>/<version>/<slug>-<version>.zip`, creates the version row
  and fetches icon, banner and screenshots from the same moving ref.
- The sandbox build (`lib/sandbox-build.ts`) runs `npm ci` with network,
  then `npm run build` with `--network none`, as uid 1000, caps dropped,
  read-only root, memory/CPU/pid limits, serialized in-process.

Webmail (`app/api/admin/marketplace`, `lib/extension-package.ts`,
`lib/plugin-sandbox/bundle-signing.ts`, `lib/admin/plugin-signing.ts`):

- Uses only four directory routes: `GET /api/v1/extensions` (forwarding
  every query parameter from its own UI), `GET /api/v1/extension/{slug}`,
  `GET /api/v1/bundle/{slug}/{version}` and `/api/v1/files/{path}` for
  icon, banner and screenshot URLs. It never calls `/api/v1/check-updates`;
  updates are found by comparing `installedVersion` with the list's
  `latestVersion`.
- From the list it reads `slug, name, type, pluginType, description,
  permissions, tags, totalDownloads, featured, minAppVersion,
  latestVersion (string), iconPath, bannerPath, author.{displayName,
  githubLogin, avatarUrl}`, and `meta.total`. From the detail it reads the
  same plus `longDescription, githubRepo, license, versions[], screenshots[]
  .path, themePreviews, latestVersion.version, createdAt, updatedAt`.
- It verifies nothing the directory says about a bundle. The install route
  downloads the zip, runs it through `readPluginPackage` (manifest check,
  file types, max 200 entries, 5 MB plugin / 2 MB theme) and stores the
  entrypoint code. From then on the webmail signs that code with **its own**
  per-install Ed25519 key (`plugin-signing.key`), and the browser verifies
  that signature before running a managed plugin. There is no notion of a
  directory key.
- The detail route downloads the latest bundle to show a source preview,
  which counts as a download in the directory.

Problems found while reading (beyond the gaps listed in the brief):

1. Any signed-in author can submit a new version of someone else's
   extension. The submission route looks the slug up but never compares
   `authorId`; approval then rewrites the extension's repo and subpath to
   the submitter's. Only the reviewer stands in the way.
2. What gets published is not what was scanned: approval rebuilds from the
   moving ref, and media come from the moving ref too.
3. Stored XSS on the directory origin: the extension page renders
   `longDescription` with `dangerouslySetInnerHTML`, and the owning author
   can set it to anything through `PATCH /api/v1/extension/{slug}`.
4. SVG icons and screenshots, and every other image, are served exactly
   as the author uploaded them. SVGs go out from the directory origin as
   `image/svg+xml` with no CSP, so an SVG with a script runs with the
   directory's cookies when opened directly.
5. The public list and detail spread whole database rows: the author's
   email address, GitHub id and ban flag, and on the detail page every
   version's full scan report, reviewer id and review notes.
6. "Latest version" is the newest by `createdAt`, not the highest semver.
   `check-updates` compares by string equality, so it "offers" an older
   version to anyone running a newer one.
7. Bans and admin removal don't take effect until the cookie expires;
   neither is checked per request.
8. The directory accepts bundles the webmail refuses: up to 2000 files and
   10 MB (webmail: 200 entries, 5 MB / 2 MB), and `type: "plugin"` plus
   `pluginType` (the webmail only accepts `hook`, `ui-extension`,
   `sidebar-app`). Its permission list is a stale copy (no `http:*`,
   `crypto:full`, `email:raw-send`, `ui:calendar-action` and about 30 more).
9. `/api/v1/files/bundles/...` serves bundle zips without checking the
   extension's status, so suspending an extension does not stop that path.
10. pm2 runs as root, and the web process itself shells out to Docker.
    Anything that gets code execution in the web app owns the host.

`npm run lint` passes today; the scripts/ override is already in
eslint.config.mjs. Only one unused-import warning is left.

## 2. Decisions

These shape everything below. Each is open to change at review.

- **Evolve the schema, don't replace it.** The core tables (`authors`,
  `extensions`, `extension_versions`, `submissions`, `screenshots`,
  `theme_previews`, `download_stats`) keep their names and ids. The rework
  adds columns and tables and never drops or rebuilds one. The migration is
  therefore additive, which means the previous release still runs against
  the migrated database and the deploy script's rollback keeps working.
  The "rethink" is in the semantics: submissions become build jobs with a
  real state machine, versions become immutable published releases.
- **Build once, at submission, from a commit SHA.** The artifact the
  reviewer looks at is byte-for-byte what gets published. Approval signs
  and moves the staged file; it never fetches or builds again.
- **A separate build worker.** Builds run in a second pm2 process that
  claims jobs from a table. The web process stops touching Docker.
  Submitting returns 202 and a status URL.
- **The webmail's rules are the directory's rules.** Manifest validation,
  file allowlist, size and entry limits and the permission list are copied
  from the webmail's `lib/extension-package.ts` and `lib/plugin-types.ts`
  into `lib/webmail-compat/`, with a sync script and a test pinned to a
  webmail version. Permission descriptions come from the webmail's
  `locales/en/common.json` (`plugins.permissions.*`).
- **v1 gets explicit serializers.** Every v1 response is built field by
  field from a frozen key list and snapshot-tested, so adding a column can
  never leak into v1 again. One deliberate change: `author.email` is always
  `null` in public responses (the key stays). The webmail doesn't read it.
- **New dependencies** (pinned exactly, all released at least two weeks
  before they were added): `jose` 6.2.12, `vitest` 4.1.11 (vitest 5's
  optional peers crash npm 10's resolver; update the lockfile with npm 11),
  `sharp` 0.34.5 (the version Next already pulls in), `esbuild` 0.25.12
  for bundling deploy scripts and later the worker, `marked` 18.0.14 and
  `sanitize-html` 2.17.7 for author Markdown (`lib/markdown.ts`).
- **Code layout:** API handlers stay thin; logic moves into `lib/` modules
  that tests call directly (`lib/publish/`, `lib/auth/`, `lib/signing/`,
  `lib/review/`, `lib/v1/serialize.ts`).
- **The Action lives in a separate repo**, `bulwarkmail/publish-extension`,
  because GitHub only lists actions in the Marketplace from a repo whose
  root holds `action.yml`. The CLI lives in this repo under `packages/cli`
  and is published as `@bulwarkmail/extension-cli`; the Action calls the
  same client code (bundled).

## 3. Data model

SQLite, drizzle. Times are integer seconds as today. `(new)` marks new
tables; for existing tables only the added columns are listed.

### authors (existing)

Added: `role` text (`author`, `reviewer`, `admin`, `super_admin`; default
`author`), `banned_at`, `banned_reason`, `banned_by`, `session_epoch`
integer (bumped to invalidate every session of this user),
`notify_email` boolean default true, `email_verified` boolean.

`banned` (boolean) stays and is kept in sync, because the previous release
reads it.

`directory_admins` stays as it is (the review columns reference it); the
migration copies each admin's role onto the matching author row, creating
the author if needed, and from then on `authors.role` is the source of
truth. Sign-in no longer mints a second cookie; one session, role checked
per request.

### extensions (existing)

Added:

- `source_host` text default `github.com`; also `gitlab.com` and
  `codeberg.org` (a fixed allowlist, no self-hosted instances).
  `github_repo` keeps its name for compatibility but holds `owner/name`
  (or `group/subgroup/name` on GitLab) for any host; `subpath` keeps its
  meaning.
- `reserved_at` (for the 90-day release of unused slugs, section 4).
- `deprecated_at`, `deprecation_message`, `replacement_slug`.
- `suspended_reason`.
- `latest_stable_version_id`, `latest_beta_version_id`: caches updated on
  approve, yank and unyank, so list queries don't scan versions.

`status` keeps its values: `pending` (reserved, nothing published yet),
`approved` (listed), `rejected` (first submission rejected), `suspended`
(pulled by an admin: no downloads at all), `archived` (owner retired it:
hidden from search, existing versions downloadable). `author_id` stays as
the owner.

### extension_members (new)

`extension_id`, `author_id`, `role` (`owner`, `maintainer`), `added_by`,
`created_at`. Maintainers can submit versions, manage publishers and
tokens for that extension, yank and edit metadata; only owners can add
members, transfer or archive. Backfilled with one owner row per extension.

### extension_versions (existing)

Stays the table of published releases only. A row exists once a submission
was approved. Added:

- `channel` (`stable`, `beta`): `beta` when the version has a semver
  pre-release part, otherwise `stable`. Backfilled the same way.
- `max_app_version`: settable afterwards by owners and admins ("does not
  work on 2.0").
- `yanked_at`, `yanked_by`, `yank_reason`.
- `submission_id` (the submission that produced it).
- Provenance: `source_host`, `source_repo`, `source_commit`, `source_ref`,
  `source_subpath`, `submitted_via` (`web`, `oidc`, `token`, `legacy`),
  `ci_workflow_ref`, `ci_run_id`, `ci_run_attempt`, `ci_event`,
  `builder_image` (image digest), `build_source` (`flat`, `dist`, `build`,
  `prebuilt-zip`, `sandbox-build`), `attestation` (JSON, see section 8).
- Signing: `signature`, `signing_key_id`, `signed_statement` (the exact
  bytes that were signed).
- `changelog_source` (`release`, `manifest`, `manual`).
- `download_count` cache.

### submissions (existing)

Becomes a build and review job. Added:

- `dry_run` boolean. Dry runs live here too so they share one pipeline;
  never reviewable, deleted after 7 days.
- `source_host`, `source_commit` (always a full SHA once resolved),
  `version`, `slug` (from the manifest at that commit).
- `submitted_via`, `submitted_by_token_id`, `ci_claims` (JSON of the
  verified OIDC claims we keep).
- `build_log` (tail, 16 KB), `build_source`, `builder_image`,
  `artifact_path` (staged zip, outside the public upload tree),
  `artifact_sha256`, `artifact_size`, `media` (JSON list of staged media).
- `release_notes` (from the GitHub release at that tag, if any).
- `diff_summary` (JSON: files added/removed/changed and permission changes
  against the latest approved version, for the reviewer).
- `attempts`, `claimed_at`, `claimed_by` (worker lease), `finished_at`.
- `poll_token_hash`, `poll_token_expires_at` (section 6.3).

`status` gets new values (section 4). `github_tag` stays and holds the ref.

### publishers (new): trusted publishing

`id`, `extension_id`, `provider` (`github`), `repository` (`owner/name`),
`repository_id`, `repository_owner_id` (numeric GitHub ids, looked up when
the publisher is added; they don't change on rename, which protects against
someone recreating a deleted repo under the same name), `workflow_path`
(`.github/workflows/publish.yml`), `environment` (nullable), `subpath`,
`allowed_refs` (`tags` default, or `any`), `created_by`, `created_at`,
`last_used_at`, `disabled_at`.

### oidc_token_uses (new)

`jti` primary key, `expires_at`. Insert before acting; a conflict means the
token was already used. Rows past `expires_at` are pruned hourly.

### api_tokens (new) and api_token_extensions (new)

`id`, `author_id`, `name`, `prefix` (first 12 characters, shown in the
dashboard), `secret_hash` (HMAC-SHA256 of the token with a server pepper
from `.env`), `scopes` (JSON: `publish`, `dry_run`, `read`), `expires_at`
(required, at most one year), `created_at`, `last_used_at`,
`last_used_ip_hash`, `revoked_at`, `revoked_by`, `revoked_reason`.
`api_token_extensions(token_id, extension_id)` lists the extensions a token
may act on; a token with no rows can do nothing.

Format: `bwx_` + 32 random bytes base62 + 6-character CRC32 checksum, so
GitHub secret scanning can be taught the pattern later and typos are
caught before a database lookup.

### signing_keys (new)

`key_id` (first 16 hex of SHA-256 of the raw public key), `public_key`
(base64 raw 32 bytes), `status` (`active`, `retired`, `revoked`),
`not_before`, `not_after`, `created_at`. The private key is not in the
database; see section 8.

### download_daily (new)

`version_id`, `day` (YYYY-MM-DD), `count`. Raw `download_stats` rows are
rolled up nightly and pruned after 90 days. The migration builds the
rollup from all existing rows; `extensions.total_downloads` stays the
running total and is never recomputed downward.

### notifications (new)

`id`, `author_id`, `kind`, `payload`, `created_at`, `sent_at`, `error`.
An outbox the worker drains (email first, webhooks later).

### webhooks (new, later phase)

`id`, `author_id`, `url`, `secret` (shown once, used for HMAC signing),
`events`, `created_at`, `last_delivery_at`, `last_status`, `disabled_at`.

### ratings, reports (new, later phase)

`ratings(extension_id, rater_kind, rater_id, stars, body, created_at,
hidden_at, hidden_by)`, unique per rater and extension.
`reports(id, extension_id, version_id, reporter_kind, reporter_id, reason,
details, status: open|actioned|dismissed, handled_by, handled_at, notes)`.
Raters are signed-in authors (`rater_kind = 'author'`); reporters are
either signed in or anonymous with an IP hash and optional contact email.

### advisories (new, later phase)

`id` (`BWX-2026-0001`), `extension_id`, `affected` (semver range string),
`fixed_in`, `severity` (`low`, `medium`, `high`, `critical`), `summary`,
`details` (Markdown), `published_at`, `updated_at`, `withdrawn_at`,
`created_by`.

### audit_log (new)

`id`, `at`, `actor_kind` (`admin`, `author`, `token`, `oidc`, `system`),
`actor_id`, `action` (`submission.approve`, `submission.reject`,
`author.ban`, `version.yank`, `token.revoke`, ...), `target_kind`,
`target_id`, `details` (JSON), `ip_hash`. Append-only; no route updates or
deletes it.

### text_changes (new)

`id`, `extension_id`, `version_id` (for a changelog), `field`,
`old_value`, `new_value`, `proposed_by`, `proposed_at`, `status`
(`pending`, `approved`, `rejected`, `withdrawn`), `reviewer_id`,
`review_notes`, `reviewed_at`. See section 4, "Text changes".

### rate_limits (new)

`key`, `window_start`, `count`. Fixed-window counters in SQLite, so limits
survive restarts and are shared by the web process and worker.

## 4. Review states

Submission:

```
queued ──> building ──> scanning ──> awaiting_review ──> approved
   │           │            │               │
   │           v            v               ├──> rejected
   │      build_failed   blocked            │
   │                                        └──> withdrawn (author)
   └──> withdrawn (author)

dry run: queued ──> building ──> scanning ──> dry_run_passed | dry_run_failed
```

- `queued`: accepted, commit resolved, waiting for the worker.
- `building`: worker holds a lease (`claimed_at`); a lease older than 15
  minutes is taken back and retried once (`attempts`).
- `build_failed`: resolving the bundle or the sandbox build failed. Terminal.
  The author resubmits.
- `scanning` then `blocked` if any finding has severity `block`, or the
  webmail-compat checks fail. Terminal.
- `awaiting_review`: artifact and media staged, diff against the latest
  approved version computed, author notified that it's in the queue.
- `approved`: in one transaction: the status changes only if it is still
  `awaiting_review` (so two reviewers can't both approve), the statement is
  signed, the version row is inserted, extension caches are updated, the
  audit entry and the notification are written. The staged files move into
  `uploads/bundles/...` and `uploads/{icons,banners,screenshots}/...` just
  before the transaction; if it fails they are removed again.
- `rejected`: reviewer notes are required and go to the author.

A version number is used up only when it is approved. After a rejection or
failure the author can submit the same version again. While a submission
for a version is between `queued` and `awaiting_review`, another one for
the same slug and version is refused with 409.

Existing `pending`/`scanning`/`review` submissions are migrated to `queued`
with no commit; the worker resolves the stored ref to a commit first. The
reviewer then sees a fresh build, which is what they should be approving
anyway.

Extension: `pending` until its first approval, then `approved`. Admins can
set `suspended` (nothing downloadable, hidden everywhere, installed copies
get an advisory if one is filed), owners can set `archived`. Deprecation is
a flag on top of `approved`.

A `pending` extension with no approved version and no open submission is
released 90 days after it was reserved (the slug becomes free and the row
is deleted with its publishers and token scopes). The owner gets an email
7 days before. Admins can extend or release by hand.

### Text changes

Every edit to public text after the first approval goes through review:
description, long description, changelog of a published version,
deprecation message, tags. The author's edit is stored in `text_changes`
as `pending`; the public pages keep showing the approved text until a
reviewer approves it (`approved`) or rejects it with notes (`rejected`).
Text that arrives with a new version (manifest description, release notes)
is reviewed together with that version. Fields with no public text
(repository link, subpath, publishers, members, `maxAppVersion`) change
without review but are audit-logged; changing the repository additionally
needs the next version to be built from the new repository before it shows.


Version: published, optionally yanked. Yanking hides it from "latest",
search and update offers; the exact-version bundle URL keeps working.
Admins can yank any version; owners and maintainers their own.

## 5. Build pipeline

The worker is a plain Node script bundled with esbuild into
`worker/worker.cjs` and shipped in the release next to `server.js`. pm2
runs it as a second app from the same ecosystem file. It:

1. claims the oldest `queued` row (`UPDATE ... WHERE status='queued' ...
   RETURNING`), real submissions before dry runs;
2. downloads the archive **by commit SHA**, checks the zip (entry count,
   total inflated size, no absolute or `..` paths, no symlinks);
3. reads and validates the manifest with the webmail-compat checks; the
   manifest's `id` must equal the extension slug the submission was made
   for;
4. resolves the bundle as today (prebuilt zip, flat, dist, build, sandbox);
5. enforces the webmail limits on the result (≤ 200 entries, ≤ 5 MB plugin
   or 2 MB theme, allowed file types) and runs `readPluginPackage`'s
   checks on the final zip, so nothing passes that a webmail would refuse;
6. scans (existing rules), computes the diff summary against the latest
   approved version, fetches media and release notes at the same commit,
   stages everything under `data/staging/<submission-id>/`.

### Source hosts

`lib/sources/` gets one module per host with the same four functions:
check the repo exists and is public, resolve a ref to a commit, download
the archive at a commit, fetch one file at a commit (manifest, media,
release notes).

| Host | Archive at a commit | Release notes |
|---|---|---|
| github.com | `api.github.com/repos/{o}/{r}/zipball/{sha}` | `/releases/tags/{tag}` |
| gitlab.com | `gitlab.com/api/v4/projects/{id}/repository/archive.zip?sha={sha}` | `/projects/{id}/releases/{tag}` |
| codeberg.org | `codeberg.org/api/v1/repos/{o}/{r}/archive/{sha}.zip` | `/repos/{o}/{r}/releases/tags/{tag}` |

The host list is fixed in code; URLs are built from it, never taken from
a request, so there is no SSRF through source URLs. Redirects are followed
only to the host's own archive domains. GitLab's numeric project id is
stored like GitHub's repository id. GitLab and Codeberg publish through
API tokens. GitLab CI also issues OIDC ID tokens, so trusted publishing
for gitlab.com can follow later with the same checks as section 7.2
(`project_id`, `namespace_id`, `ci_config_ref_uri`, `environment`);
Forgejo Actions has no OIDC tokens yet.

### Media

No image the author supplies is ever delivered as-is. The worker decodes
every icon, banner, screenshot and theme preview and re-encodes it before
staging; the files route and the pages only ever serve those outputs.

- **Library:** `sharp` (libvips; SVG through librsvg, which runs no
  scripts and loads no external resources). Prebuilt binaries for
  linux-x64 and win32-x64, so CI, the server and local tests work without
  a compiler.
- **Input:** PNG, JPEG, WebP, GIF (first frame) and SVG, detected from the
  bytes, not the file name. Anything else is a warning and is dropped.
- **Limits before decoding:** file size as today (256 KB icon, 512 KB
  banner and screenshot, 2 MB gallery), `limitInputPixels` of 25 megapixels,
  SVGs with a `viewBox` or width/height over 4096 refused, SVGs with
  external references (`href` to `http:`, `file:`, `data:` other than
  images) refused.
- **Output:**
  - icon: 512×512 PNG (square, transparent padding when needed),
  - banner: up to 1600 px wide WebP,
  - screenshots and theme previews: up to 1920 px wide WebP.

  Every browser the webmail supports shows WebP; the social card renderer
  doesn't, so it converts the banner to PNG when it draws the card.
  Re-encoding drops all metadata (EXIF, text chunks, ICC except sRGB
  conversion). File names are generated with a content hash
  (`media/<slug>/icon-<hash>.png`, `media/<slug>/screenshot-2-<hash>.webp`),
  never taken from the repo, so they can be cached forever.
- **Where:** in the worker, never in the web process, since image decoders
  are a common attack surface. Until the worker exists (phase 3) the
  approval route does it.
- **Fonts:** SVG banners often contain text. librsvg draws it with the
  fonts installed where the conversion runs, so the server (and later the
  worker) needs a font package (`fonts-dejavu-core`, plus
  `fonts-noto-core` for wider coverage), or the text comes out missing.
- **Existing files:** `lib/reencode-media.ts` converts every stored image
  the same way, writes the new files next to the old ones and updates
  `icon_path`, `banner_path`, `screenshots.path` and
  `theme_previews.preview_path`. The old files stay on disk but are not
  served any more. It is idempotent, has a `--dry-run`, and runs from
  `deploy/migrate.cjs` (bundled to `deploy/dist/reencode-media.cjs` by
  `npm run build:scripts`). An image that can't be converted is dropped
  (icon or banner cleared, screenshot row deleted) and reported. Built in
  phase 1.

The webmail builds image URLs from `iconPath`, `bannerPath` and
`screenshots[].path`, so it picks up the new paths without a change.

Sandbox changes:

- `npm ci --ignore-scripts` in the install phase (install scripts are the
  usual npm attack path, and they're the only author code that runs with
  network). esbuild, Vite and tsc work without them. If a plugin really
  needs one, the build fails with a message saying so.
- Image pinned by digest (`SANDBOX_BUILD_IMAGE=node:22-alpine@sha256:...`),
  digest recorded on the submission and version.
- The work directory gets a size cap (a loop-mounted or tmpfs volume of
  512 MB, or a `du` check between phases if mounting isn't allowed).
- The build cache stays keyed by source hash plus image digest.
- Builds run on a **separate build VM** on the rath.li Proxmox, not on
  mail.rath.li. The worker on mail.rath.li stays the scheduler: it fetches
  and checks the archive, then sends the extracted source to the VM over
  SSH with a forced command (`extbuild run <job-id>`, source as a tar on
  stdin, output tar on stdout, log on stderr), the same pattern as
  `extdir-deploy`. On the VM the build runs in Docker with the flags
  above. The VM:
  - holds no secrets and no directory data; it can be wiped and rebuilt
    from a script at any time;
  - reaches only the npm registry (firewall egress allowlist for
    `registry.npmjs.org` during the install phase; nothing during the
    build phase) and accepts SSH only from mail.rath.li;
  - is reset to a clean snapshot on a schedule (nightly) so a build that
    escapes the container can't persist.
  The runner is pluggable (`SANDBOX_RUNNER=local|ssh`), so tests and local
  development use local Docker or a fake runner.
- On mail.rath.li the web app and the worker run as two non-root users
  (`extdir-web`, `extdir-worker`); neither needs Docker any more. pm2
  starts each app with its `user`. The setup commands go in
  `deploy/README.md` for you to run.

## 6. API

### 6.1 v1: frozen

Kept forever, same paths, methods, status codes and JSON keys:

| Route | Notes |
|---|---|
| `GET /api/v1/extensions` | `{ data: Extension[], meta: { page, perPage, total } }` |
| `GET /api/v1/extension/{slug}` | `{ data: ExtensionDetail }` |
| `GET /api/v1/bundle/{slug}/{version}` | zip, `X-Content-SHA256`, `Content-Disposition` |
| `GET /api/v1/files/{path}` | icons, banners, screenshots, theme previews, bundles |
| `POST /api/v1/check-updates` | `{ data: { updates[], upToDate[] } }` |
| `GET /api/v1/extension/{slug}/{versions,readme,screenshots,icon}`, `GET /api/v1/extensions/{featured,popular,recent}`, `GET /api/v1/stats` | the website used these; kept |

Changes in behaviour, all compatible:

- Only `approved` extensions; within them, `latestVersion` is the highest
  semver among stable, non-yanked versions (was: newest `createdAt`). The
  extension-level `permissions` and `minAppVersion` are that version's.
- Beta and yanked versions are left out of the detail's `versions` array
  and never become `latestVersion`. Their bundle URLs still work.
- Optional `appVersion` query parameter on list, detail and check-updates:
  `latestVersion` becomes the newest stable version whose
  `minAppVersion <= appVersion <= maxAppVersion`. Old webmails don't send
  it and get today's behaviour. The webmail already forwards every query
  parameter of the list, so it only needs to add one.
- `check-updates` compares by semver and only offers newer, compatible,
  non-yanked versions.
- `author.email` is `null`. Detail `versions[].scanReport`,
  `reviewNotes` and `reviewerId` are `null`. Keys stay.
- The bundle route answers 404 for suspended extensions and also counts a
  download only once per IP hash, version and day (the webmail's preview
  fetch currently counts as an install).
- The bundle route adds headers `X-Bundle-Signature`,
  `X-Bundle-Signature-Key` and `X-Bundle-Statement` (section 8). Old
  webmails ignore them.
- `/api/v1/files/` serves only re-encoded images under `media/` (section
  5, "Media") and bundle zips of approved versions of approved extensions.
  The old raw paths (`icons/`, `banners/`, `screenshots/`,
  `theme-previews/`, any SVG) answer 404. Webmails build image URLs from
  the paths in each list response, so they follow the new paths without a
  change. Every response gets `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; sandbox`. Done in phase 1.
- `POST /api/v1/submissions`, the v1 auth routes and the v1 admin routes
  keep working for the old UI until the new UI ships, then the write
  routes answer 410 with a pointer to v2. Nothing outside this repo calls
  them.

Before any of this changes, the current responses are snapshotted against
a seeded database (section 15).

### 6.2 v2: public

JSON, `{ data }` or `{ error: { code, message, details? } }`. Lists take
`page`, `perPage` (≤ 100), and return `meta`.

```
GET  /api/v2/extensions?type=&q=&tag=&sort=&appVersion=&channel=stable|beta
GET  /api/v2/extensions/{slug}?appVersion=&channel=
GET  /api/v2/extensions/{slug}/versions?include=yanked,beta
GET  /api/v2/extensions/{slug}/versions/{version}
       provenance, signature, changelog, yanked, compat range, permissions
GET  /api/v2/extensions/{slug}/versions/{version}/bundle
GET  /api/v2/extensions/{slug}/versions/{version}/provenance
       the signed statement and attestation JSON
POST /api/v2/updates
       { appVersion, channel, installed: [{ slug, version }] } →
       { updates[], yanked[], deprecated[], advisories[], unknown[] }
GET  /api/v2/advisories?since=<iso>
GET  /api/v2/keys            (also /.well-known/bulwark-extension-keys.json)
```

### 6.3 v2: publishing

```
POST /api/v2/publish
POST /api/v2/publish/dry-run
  Authorization: Bearer <GitHub OIDC JWT> | Bearer bwx_...
  { "slug"?: "...", "subpath"?: "...", "ref"?: "...",
    "repository"?: "owner/name" }            (token only, see 7.3)
  → 202 { data: { id, status: "queued", url, statusUrl, pollToken } }

GET    /api/v2/submissions/{id}
  Authorization: Bearer <pollToken> | Bearer bwx_... | session
  → { id, status, slug, version, commit, buildLog?, scan: { findings },
      reviewUrl, decidedAt?, notes? }
DELETE /api/v2/submissions/{id}          withdraw (token, session)
```

`url` is the human page (`/dashboard/submissions/{id}`). Because an OIDC
token can be used once, the response carries a `pollToken`: random,
stored hashed, valid for one hour, good only for reading that submission.
The Action and the CLI poll until the status leaves `queued`, `building`
and `scanning`, then report `awaiting_review` (success) or the build or
scan problems (failure).

### 6.4 v2: author (session)

```
GET    /api/v2/me
GET    /api/v2/me/extensions
POST   /api/v2/extensions                       reserve a slug
PATCH  /api/v2/extensions/{slug}                metadata, source repo
POST   /api/v2/extensions/{slug}/members        DELETE .../{authorId}
GET    /api/v2/extensions/{slug}/publishers     POST, DELETE .../{id}
GET    /api/v2/tokens                           POST (secret shown once), DELETE .../{id}
POST   /api/v2/extensions/{slug}/versions/{v}/yank      unyank
PATCH  /api/v2/extensions/{slug}/versions/{v}           maxAppVersion, changelog
POST   /api/v2/extensions/{slug}/deprecate              { message, replacement? }
GET    /api/v2/extensions/{slug}/stats?from=&to=        per-version daily downloads
GET    /api/v2/me/submissions
PATCH  /api/v2/me/notifications
```

### 6.5 v2: admin (session with role)

```
GET  /api/v2/admin/submissions?status=awaiting_review
GET  /api/v2/admin/submissions/{id}           artifact listing, file view, diff
POST /api/v2/admin/submissions/{id}/approve   { notes? }
POST /api/v2/admin/submissions/{id}/reject    { notes }
POST /api/v2/admin/submissions/{id}/rebuild
GET  /api/v2/admin/authors                    POST .../{id}/ban { reason }, .../unban, .../role
GET  /api/v2/admin/extensions                 PATCH .../{slug} (status, featured, owner)
POST /api/v2/admin/versions/{id}/yank
GET  /api/v2/admin/tokens                     POST .../{id}/revoke
POST /api/v2/admin/advisories                 PATCH, withdraw
GET  /api/v2/admin/reports                    PATCH .../{id}
GET  /api/v2/admin/audit?actor=&action=&target=
```

Roles: `reviewer` can list and decide submissions and read reports;
`admin` adds bans, yanks, suspensions, advisories, token revocation,
featuring; `super_admin` adds role changes and signing key management.

## 7. Auth flows

### 7.1 Browser session

GitHub OAuth as today, one iron-session cookie holding `authorId` and
`sessionEpoch`. Every request that needs a user loads the author row and
refuses when `banned_at` is set or the epoch doesn't match. State-changing
session routes also require an `Origin` header equal to the site URL.
Banning bumps the epoch, so the ban takes effect on the next request.

### 7.2 GitHub OIDC trusted publishing

The author adds a publisher to an extension in the dashboard: repository
(the directory looks up `repository_id` and `owner_id` and checks the repo
is public), workflow file, optional environment, subpath, refs allowed
(tags only by default).

The workflow:

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: bulwarkmail/publish-extension@v1
    with:
      subpath: jitsi-meet      # monorepos only
```

The action requests a token with `audience=https://extensions.bulwarkmail.org`
and posts it to `/api/v2/publish`. The directory, in this order:

1. Rate limit by IP (section 16) before any crypto.
2. Parse the JWT header: `alg` must be `RS256`, `kid` present.
3. Verify the signature with `jose` against
   `https://token.actions.githubusercontent.com/.well-known/jwks`. JWKS is
   cached for an hour and refetched once when an unknown `kid` shows up;
   refetches are throttled.
4. `iss` equals `https://token.actions.githubusercontent.com`.
5. `aud` equals the configured audience exactly (string or one-element
   array).
6. `exp` is in the future, `nbf`/`iat` not in the future, with 60 s of
   clock skew allowed; `exp - iat` at most 15 minutes.
7. Find publishers whose `repository_id` and `repository_owner_id` equal
   the claims (not the name). None: 403.
8. Narrow by `workflow_ref`: its path part (between `owner/repo/` and `@`)
   must equal `workflow_path`. We use `workflow_ref`, not
   `job_workflow_ref`, so it names the author's own workflow file.
9. If the publisher has an `environment`, the `environment` claim must
   equal it. A token without an environment claim fails.
10. If the publisher allows tags only, `ref` must start with `refs/tags/`.
11. Narrow by the body's `subpath` (default empty). Exactly one publisher
    must remain; otherwise 403 (zero) or 409 (ambiguous).
12. `ref` in the body, if given, must equal the `ref` claim. The commit
    built is always the `sha` claim; the body cannot change it.
13. The extension must not be suspended; its owner and the publisher's
    creator must not be banned.
14. Insert `jti` into `oidc_token_uses`. A conflict means a replay: 409.
    This happens last among the checks and before any side effect, so a
    rejected request doesn't burn the token, and a replay can never create
    a second submission.
15. Create the submission (`submitted_via: oidc`, claims kept: repository,
    repository_id, sha, ref, workflow_ref, run_id, run_attempt, actor,
    event_name, environment, runner_environment).

Pull requests: tokens for `pull_request` events from forks don't exist,
and same-repo PRs have a `refs/pull/...` ref. Dry runs accept any ref
(step 10 is skipped) so a PR workflow can run them; real publishes keep
the tag rule.

### 7.3 Scoped API tokens

Created in the dashboard with a name, extensions, scopes and expiry (30,
90, 365 days). The secret is shown once. Lookup: check prefix and
checksum, find the row by prefix, compare the HMAC in constant time. Then:
not revoked, not expired, owner not banned, owner still a member of the
target extension, scope covers the request (`publish` or `dry_run`), the
extension is in the token's list. `last_used_at` and the IP hash are
updated.

A token request names the extension by `slug`. The repository always comes
from the extension's stored source (`source_host`, `github_repo`, `subpath`),
never from the request; a request that sends a different `repository` gets
400. The ref is resolved to a commit when the submission is created.

Revocation by the owner or an admin is immediate (the next lookup fails)
and audit-logged.

### 7.4 Ban enforcement, all paths

One function, `assertActorAllowed(author, extension)`, is called by
session, token and OIDC paths before a submission is created, and again
by the worker before it starts a build and by approval. A ban also
withdraws the author's open submissions and disables their tokens (marked
revoked with reason `ban`).

## 8. Signing and provenance

### Keys

- An **offline root key** (Ed25519) lives in the vault, collection
  "Agent" (item `Bulwark extensions – root signing key`), and on no
  server. It signs the keyring document only. Signing the keyring is a
  local script run through `vw exec --file`, so the key never lands in a
  file, a log or the conversation.
- An **online signing key** lives on the server in a file outside the
  release and the database (`/opt/extension-directory/keys/signing.pem`,
  mode 0600), path given by `SIGNING_KEY_FILE`, readable only by the
  `extdir-worker` user. The web process never holds it: approval moves
  the submission to `approved` with a `signing` flag, and the worker
  signs and publishes within seconds. A compromised web process can
  therefore approve (which the audit log shows) but can't sign arbitrary
  bytes. A copy of the online key is also stored in the vault (Agent) for
  disaster recovery.
- `GET /api/v2/keys` serves the keyring: `{ keys: [{ keyId, publicKey,
  status, notBefore, notAfter }], issuedAt, rootKeyId, signature }`,
  signed by the root key.

Rotation: generate a new online key, add it to the keyring as `active`,
mark the old one `retired`, sign the keyring with the root key, re-sign
every approved version with the new key (a script; a few seconds). A
compromised key is marked `revoked` and everything is re-signed. The
webmail pins only root public keys (the current one and a spare kept
offline), so rotating the online key needs no webmail release.

### What gets signed

A release statement, canonical JSON (sorted keys, no whitespace, UTF-8):

```json
{"_type":"https://extensions.bulwarkmail.org/release/v1",
 "approvedAt":"2026-10-20T10:00:00Z",
 "bundle":{"sha256":"…","size":12345},
 "kind":"plugin","slug":"jitsi-meet","version":"1.2.0",
 "source":{"commit":"…40 hex…","host":"github.com","repo":"bulwarkmail/plugins","subpath":"jitsi-meet"}}
```

Ed25519 over those bytes. Binding slug and version stops a validly signed
bundle from being served under another extension's name or as a different
version. The canonical JSON function is the same as the webmail's
`canonicalJson` in `lib/extension-package.ts`. The bundle route sends:

```
X-Bundle-Statement: <base64 of the statement bytes>
X-Bundle-Signature: <base64 64-byte signature>
X-Bundle-Signature-Key: <keyId>
```

The webmail today uses raw 32-byte keys and base64 signatures with
`@noble/curves` as a fallback, so it can verify this with code it already
has.

### Provenance

Recorded on every version: host, repo, commit, ref, subpath, how it was
submitted, and for OIDC the workflow ref, run id and attempt, event and
actor from the verified token. The version page shows "Built from commit
`abc1234` (tag `v1.2.0`) by workflow `publish.yml`, run #123" with links,
or "Submitted with API token `ci-gitlab` by @user" / "Submitted on the
website by @user", and "Imported from the old directory" for migrated
versions (their commit is unknown; only the ref is).

The directory also writes its own provenance document per version (in-toto
statement with a SLSA v1 predicate: builder = directory worker and image
digest, external parameters = repo, commit, subpath, internal = build
source), signed with the same key and served at `.../provenance`.

GitHub artifact attestations made by the author's workflow describe files
the author built, not the bundle the directory built, so they can't vouch
for the published zip. Decided: the directory's own signed provenance is
enough for now. A later idea, not planned: look up author attestations by
the digest of a file we built (`GET /repos/{owner}/{repo}/attestations/
sha256:{digest}`) and show "matches the author's attested build" when a
build is reproducible.

## 9. Release lifecycle

- **Channels.** A semver pre-release (`1.3.0-beta.1`) is `beta`. The v2
  routes take `channel=beta` to include them; v1 never shows them as
  latest. The webmail shows betas only when an admin turns on a setting.
- **Yank.** Owners, maintainers or admins, with a reason. Hidden from
  search, latest and update offers; the exact bundle URL works; `/updates`
  tells webmails running it that it was yanked and why.
- **Deprecate.** Extension-level message and optional replacement slug.
  Still installable; listed lower; `/updates` reports it.
- **Compatibility.** `minAppVersion` from the manifest, `maxAppVersion`
  set on the directory side per version. Every "latest" and update query
  that knows the app version filters on both.
- **Changelogs.** When the commit is a tag with a GitHub release, the
  release body is taken at submission time. Otherwise the manifest's
  `changelog` string, otherwise empty. Rendered as sanitized Markdown.
  Owners can propose an edit later; it goes to the review queue as a
  text-only change (section 4, "Text changes") and is audit-logged.

## 10. Author tooling

- **Action** (`bulwarkmail/publish-extension`, a JavaScript action, not a
  reusable workflow, so `workflow_ref` stays the author's file). Inputs:
  `subpath`, `ref` (default the triggering ref), `dry-run`,
  `directory-url` (default production), `token` (optional; uses OIDC when
  absent), `wait` (default true). Outputs: `submission-id`,
  `submission-url`, `status`. Writes a job summary with the scan findings.
  Fails the job on build failure, a blocking scan finding, or any 4xx.
- **CLI** `npx @bulwarkmail/extension-cli`:
  `validate [dir]` runs the webmail-compat manifest and package checks
  locally without network; `dry-run` and `publish` call the API with
  `BULWARK_EXTENSIONS_TOKEN` (or OIDC when it detects GitHub Actions);
  `status <id>`. Same client code as the Action.
- **Notifications.** Email from `noreply@bulwarkmail.org` (a new account on
  the Stalwart on rath.li, created in that phase; SMTP login in the vault,
  collection "Alle", rendered into `.env` with `vw render`) to the
  author's verified GitHub email:
  submission queued for review, approved, rejected with notes, build failed
  or blocked by the scan (for CI submissions; the CI run already shows it,
  so this is a setting). Webhooks in a later step with HMAC signatures and
  an SSRF guard (resolve, block private ranges, pin the address).
- **Stats.** Per-version daily downloads from `download_daily` in the
  dashboard.

## 11. Users and admins

- **Ratings** need a directory sign-in with GitHub: one rating (stars plus
  optional text) per account and extension, editable, banned accounts
  can't rate. The webmail links to the extension page for rating.
- **Abuse reports** are open to anyone, no account needed, so a webmail
  admin can report straight from their admin page or the directory site.
  A report has extension, optional version, reason (malware, privacy,
  broken, impersonation, other), details and an optional contact email.
  Against floods: 5 reports per IP hash per day, a honeypot field, a
  60-second minimum between page load and submit on the site form, and
  identical reports folded together. A signed-in reporter is recorded as
  such. Reports with reason malware notify all admins at once.
- Moderators hide ratings and act on reports; both are audit-logged.
- **Advisories.** Admins (and owners, subject to admin publishing) file an
  advisory against a version range. `/api/v2/advisories` and
  `/api/v2/updates` return them; the webmail shows them to admins who have
  an affected version installed. A critical advisory can come with a yank
  or a suspension.
- **Audit log.** Every approval, rejection, ban, unban, role change, yank,
  unyank, suspension, deprecation, token creation and revocation,
  publisher change, advisory change and key operation. Admin page with
  filters.
- **Bans.** Section 7.4.

## 12. Webmail changes needed

None are needed for the directory to ship; old webmails keep working on v1.
To use the new features the webmail needs, in order of value:

1. **Verify directory signatures on install.** In
   `app/api/admin/marketplace/route.ts` POST, before `readPluginPackage`:
   read the three headers, fetch and cache `/api/v2/keys`, check its root
   signature against pinned root keys (new constant in
   `lib/admin/directory-keys.ts`, plus an `extensionDirectoryRootKeys`
   setting for self-hosted directories), check the key is active or
   retired (not revoked), verify the signature, compare `sha256` and
   `size` with the downloaded bytes and `slug`/`version`/`kind` with the
   request. Refuse on failure for the default directory; for a custom
   directory URL with no configured keys, warn and continue. Same check
   in the `[slug]` preview route.
2. **Send `appVersion`** from the marketplace UI (or have the route add it)
   to list and detail, so the directory only offers compatible versions.
3. **Use `/api/v2/updates`** when the admin marketplace or plugin page
   loads, and show yanked, deprecated and advisory notices on installed
   extensions.
4. **Beta opt-in**: an `extensionDirectoryChannel` setting
   (`stable`/`beta`) passed as `channel`.
5. Ratings and reports UI, once the rater question is settled.
6. Move list, detail and bundle calls to v2 when convenient. v1 stays, so
   there is no deadline.

The directory side of 1-4 lands before the webmail changes, behind the v1
headers and v2 routes.

## 13. UI

Same Flat fields tokens and `.bw-*` classes from `app/globals.css`, kept in
step with bulwarkmail/website. Pages:

- Public: home, browse (plugins, themes, search), extension page
  (sanitized Markdown description, permissions with the webmail's
  descriptions and high-risk marks, versions with channel, yanked and
  provenance, changelog per version, advisories, deprecation banner),
  author page.
- Author dashboard: extensions, new extension (reserve slug, link repo),
  per extension: versions, submissions with live status and build log,
  publishers, members, stats, settings; tokens; notifications.
- Admin: review queue (file browser of the staged zip, diff against the
  previous version, permission changes highlighted, scan findings, build
  log, provenance, approve/reject with notes), authors, extensions,
  reports, advisories, tokens, audit log.

## 14. Migration

One drizzle migration, `0003_publishing.sql`, run by `deploy/migrate.cjs`
after its backup, exactly as today. Contents:

1. `ALTER TABLE ... ADD COLUMN` for every added column, with defaults.
2. `CREATE TABLE` for the new tables and their indexes, including a
   partial unique index that stops two open submissions for the same
   extension and version.
3. Backfills in SQL:
   - `extension_versions.channel` from the version string;
   - `extension_versions.submission_id` from `submissions.version_id`;
     `source_repo`, `source_ref`, `source_subpath` from that submission,
     `submitted_via = 'legacy'`;
   - `extension_versions.download_count` and `download_daily` from
     `download_stats`;
   - `extensions.latest_stable_version_id` by semver (done by a small
     `migrate.cjs` post-step in JS, since SQLite can't compare semver;
     the step is idempotent);
   - `extension_members` owner rows;
   - `authors.role` from `directory_admins` (insert missing authors);
     `authors.banned_at` from `banned`;
   - open submissions (`pending`, `scanning`, `review`) to `queued`.
4. No `DROP`, no table rebuilds, no changes to files on disk. Bundles,
   icons, banners and screenshots stay at their paths; `/api/v1/files/...`
   URLs in deployed webmails keep resolving.

After migrating, a check script (`scripts/verify-migration.cjs`, also run
by `migrate.cjs` when `--verify` is passed) compares row counts per table
before and after, checks every version's bundle file exists and its SHA-256
matches `bundle_sha256`, checks every screenshot, icon and banner path
exists, and that sum of `download_count` equals the `download_stats` count.
It prints problems; it does not fix them.

Signing existing versions is a separate script run once after deploy, when
the key is in place: `node scripts/sign-versions.cjs`.

The deploy order:

1. Deploy release N+1 with the migration. The web process serves v1 and
   v2; the worker starts.
2. Install the signing key, run the signing script.
3. Rollback to N works at any point: the schema is a superset, N ignores
   the new columns and tables. Submissions created by N+1 in new states are
   invisible to N's admin queue, which only lists `pending`/`scanning`/
   `review`.

Server changes that the deploy script can't make (the ecosystem file gets
a second app; a `keys/` directory; SMTP and token-pepper variables in
`.env`; the worker's user and Docker group if we do that) are listed in
`deploy/README` with commands for you to run.

Testing it on real data: copy the newest file from
`/opt/extension-directory/backups/` and `data/uploads/` from mail.rath.li
into my scratchpad (read only on the server), run `migrate.cjs --verify`
against the copy, and keep that run as a test fixture outside the repo
(it holds author email addresses, so it never gets committed).

## 15. Tests

Vitest, run with `npm test`. Route handlers are called directly with
`NextRequest` objects against a temp SQLite database migrated with the real
migrations. Every test listed here gets checked to fail with the behaviour
broken (I'll note how for each in the commit or test comment).

- **v1 snapshots first.** Before touching any code: seed a database with
  a plugin with two versions, a theme with previews and screenshots, a
  pending extension and a suspended one, then snapshot the JSON of every
  v1 GET route and the headers of the bundle route. Later changes must
  keep keys and types; values change only where section 6.1 says so, and
  those diffs are reviewed by hand.
- **OIDC**: a local RSA key and a fake JWKS endpoint. Wrong issuer, wrong
  audience, expired, not yet valid, too long-lived, wrong `alg`, unknown
  `kid`, bad signature, wrong `repository_id` with the right name, wrong
  workflow file, missing or wrong environment, branch ref when tags only,
  ambiguous subpath, body ref differing from the claim, banned owner,
  suspended extension, and the same token twice (second gets 409, only one
  submission exists). Plus one test that a valid token creates a
  submission pinned to the `sha` claim.
- **Tokens**: wrong checksum, unknown prefix, wrong secret, expired,
  revoked, extension outside scope, `dry_run` scope used for publish,
  owner removed from the extension, owner banned, `repository` in the
  body, last-used updated.
- **Bans**: session, token and OIDC paths each refused; ban withdraws open
  submissions and revokes tokens; worker refuses to build for a banned
  author.
- **Ownership**: a second author can't submit a version of someone else's
  extension (the bug in section 1).
- **Review state machine**: two concurrent approvals produce one version;
  rejection needs notes; a version number is reusable after rejection,
  not after approval; withdrawn submissions can't be approved.
- **Build and scan**: built from the commit SHA, not the ref (the fake
  GitHub serves different content for the ref); webmail-compat limits
  refuse 201 entries and `type: "plugin"`; zip with `..` entries refused.
- **Signing**: statement canonicalization matches the webmail's
  `canonicalJson`; a signature from the server verifies with `@noble/curves`
  the same way the webmail does; changing slug, version or a byte of the
  bundle fails verification; keyring signature checks.
- **Release lifecycle**: yanked and beta versions never become v1
  `latestVersion`; exact bundle URL still serves a yanked version; suspended
  extension's bundle 404s on both bundle and files routes; `appVersion`
  filtering on min and max.
- **Media**: an SVG icon with a `<script>` comes out as a PNG without it;
  a PNG with a text chunk or EXIF comes out stripped; a JPEG renamed
  `.png` is decoded by content, not name; a 20000×20000 image and an
  oversized SVG `viewBox` are refused before decoding; the files route
  never answers with `image/svg+xml`, also for a migrated `.svg` path;
  staging and unknown prefixes 404.
- **Rate limits**: the N+1th publish in a window gets 429.
- **Migration**: run all migrations on a database built from the
  0000-0002 schema with fixture rows, then `--verify`; plus the run against
  the copy of production data described above.

`npm test` goes into the CI workflow next to lint, typecheck and build.

Verification of the built app uses a scratch copy: `next build` and
`next start` on a free port, never the dev server on :3002.

## 16. Threat model

What the directory protects: the code that ends up running inside people's
mail clients, with access to their mailbox. The assets are the published
bundles, the signing key, the review decision, and authors' accounts.

| Threat | Mitigation |
|---|---|
| Attacker publishes malicious code under someone else's extension | Ownership and membership checked on every path; OIDC bound to repository and owner ids, workflow file and environment; tokens scoped to extensions; repo never taken from token requests. |
| Malicious author slips code past review | Manual review of every version with the exact artifact, a diff to the previous version and highlighted permission changes; scanner; webmail sandbox remains the real boundary; yank, suspend and advisories after the fact. |
| What's reviewed differs from what's published | Build once from a commit SHA; approval signs the staged bytes' hash. |
| Replayed or stolen OIDC token | 15-minute max lifetime, single use by `jti`, audience bound to the directory. |
| Leaked API token | Shown once, stored as HMAC, scoped, expiring, revocable, last use recorded; recognizable prefix for secret scanning. |
| Compromised server swaps bundles at rest | Signatures checked by the webmail against keys from a keyring signed by an offline root key. A full server compromise can sign with the online key, which is why the root key is offline and the online key can be revoked and everything re-signed. |
| Sandbox escape during build | Builds run on a separate VM with no secrets and no directory data, egress limited to the npm registry, reset nightly; inside it Docker with install scripts off, no network during build, caps dropped, read-only root, limits, pinned image. An escape gets a disposable VM, not mail.rath.li. |
| Compromise of the web process | Runs as an unprivileged user without Docker or the signing key; can approve but not sign arbitrary bytes; approvals are audit-logged. |
| Supply chain of build dependencies | Lockfile required for `npm ci`; install scripts off; the reviewer sees the built output, not just the source. |
| Resource abuse (build farm, disk) | Rate limits per IP, author, token, repo; queue cap with 429; dry runs lower priority; size caps on archive, source, work dir and output. |
| XSS on the directory origin | Sanitized Markdown, never raw HTML; every icon, banner, screenshot and preview re-encoded to PNG/WebP at ingestion, so no author-supplied file is ever served as-is; sandbox CSP on files; site-wide CSP. |
| Malicious image files (decoder bugs, decompression bombs, metadata) | Size and pixel limits checked from the header before decoding; decoding and re-encoding in the worker, not the web process; metadata stripped by re-encoding. |
| SSRF through source hosts or webhooks | Source hosts from an allowlist; webhook delivery resolves, blocks private and loopback ranges, pins the address, no redirects. |
| Privacy | Emails never in public responses; IPs only as salted hashes; raw download rows pruned after 90 days. |
| Admin account takeover | GitHub account security only today; role checked per request; audit log. Open question about requiring 2FA. |

Rate limits (initial values): publish 10 per hour per extension and 30 per
day per author; dry runs 30 per day per author and 5 per hour per
repository; any v2 write 60 per minute per IP; build queue capped at 50
queued jobs (429 above). nginx keeps a coarse `limit_req` in front of
`/api/v2/publish`.

## 17. Phases

Each phase ends with lint, typecheck, `npm test` and a scratch-copy build
and start, and is committed in your style. Nothing pushed, nothing deployed.

1. **Groundwork.** Vitest, the v1 snapshot tests against today's code,
   test helpers (temp DB, fake GitHub, fake JWKS). Then the v1 serializers
   and the security fixes that don't need the new model: ownership check,
   raw HTML, rasterizing media (including a script that converts the
   stored SVGs), email in public output, files-route prefixes.
2. **Data model and migration.** Schema, `0003_publishing.sql`, the
   post-step, `--verify`, the migration tests, the real-data run.
3. **Pipeline.** webmail-compat module and sync script, worker with the
   state machine, build by commit, staging, sandbox changes, ban checks.
4. **Publishing API.** OIDC, tokens, publish, dry run, submission status,
   poll tokens, rate limits, audit log.
5. **Action and CLI.** `packages/cli`, the action repo contents (prepared
   here under `action/` for you to create the repo from), docs for
   authors.
6. **UI.** Dashboard, admin review with diff, public pages, Flat fields.
7. **Signing and provenance.** Keys, statement, headers, keyring, signing
   script, provenance documents, version page. Webmail patch prepared as a
   separate branch in the webmail repo, not merged.
8. **Release lifecycle.** Channels, yank, deprecate, compat filtering,
   changelogs, `/api/v2/updates`.
9. **Author tooling.** Email notifications, per-version stats, then
   webhooks.
10. **Users and admins.** Ratings, reports, moderation, advisories, audit
    log page.

## 18. Decisions from review (2026-10-14)

- **Images:** every icon, banner, screenshot and preview is re-encoded to
  PNG/WebP before it is stored or shown; stored SVGs are converted
  (section 5, "Media").
- **Ratings** need a GitHub sign-in on the directory; **abuse reports** are
  open to anyone (section 11).
- **Server users:** web app and worker as separate non-root users; setup
  commands in `deploy/README.md` for you to run.
- **Sandbox:** builds on a separate build VM on the rath.li Proxmox, reached
  over SSH with a forced command (section 5).
- **Source hosts:** github.com, gitlab.com and codeberg.org; no
  self-hosted instances.
- **Production data:** I copy the newest backup and `data/uploads/` from
  mail.rath.li into my scratchpad for the migration test, read only on the
  server, deleted afterwards.
- **Email:** from `noreply@bulwarkmail.org`, a new account on the Stalwart
  on rath.li, login in the vault.
- **Root signing key:** in the vault, collection "Agent".
- **Old v1 write routes and `/submit`:** answer 410 as soon as the new UI
  ships.
- **Unused slugs** are released after 90 days.
- **All public text edits after approval** (changelog, description, long
  description, deprecation message, tags) need review (section 4, "Text
  changes").
- **Attestations:** the directory's own signed provenance only.
- **Worktree:** I work in `C:\Users\info\worktrees\extension-directory-rework`
  because this checkout has someone else's uncommitted `package.json`
  change.

## 19. Still open

1. **Build VM creation.** Creating the VM on Proxmox, its firewall rules
   and the SSH key pair is infrastructure work. I'll write the provisioning
   script in phase 3 and ask before running anything on Proxmox.
2. **Mail account.** Creating `noreply@bulwarkmail.org` on Stalwart happens
   in phase 9; I'll ask before creating it.
