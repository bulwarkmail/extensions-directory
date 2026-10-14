# Bulwark Extensions

The directory of plugins and themes for [Bulwark Webmail](https://bulwarkmail.org), live at
[extensions.bulwarkmail.org](https://extensions.bulwarkmail.org). Authors add an extension in the
dashboard and submit versions from the website, from GitHub Actions (trusted publishing, no secrets) or
from any CI with a scoped API token. The directory builds every version itself from the named commit,
runs the webmail's own install checks and a code scanner, and a reviewer approves it before it is
published and signed. Bulwark's admin console installs extensions from here. How authors publish:
[`content/publishing.md`](content/publishing.md) (served at `/publishing`). The design and its reasons:
[`docs/rework-plan.md`](docs/rework-plan.md).

Next.js 16 (App Router, standalone output), SQLite through better-sqlite3 and Drizzle, iron-session for
sessions. The design follows the Bulwark website's "Flat fields" system: the tokens and `.bw-*` classes
in `app/globals.css` are copied from [bulwarkmail/website](https://github.com/bulwarkmail/website) and
must stay in step with it.

## Layout

- `app/api/v1` is what deployed webmails call; its responses are frozen (`tests/v1`).
- `app/api/v2` is the current API: `/publish`, `/publish/dry-run`, `/submissions/{id}`, and everything
  else through one route table in `lib/api/v2.ts`.
- `lib/pipeline` builds submissions; `lib/worker.ts` runs it as a second process
  (`worker/main.ts`), which also publishes approved versions, signs them and sends mail.
- `lib/webmail-compat/vendor` is a verbatim copy of the webmail's package checks. Refresh it with
  `node scripts/sync-webmail-compat.mjs <webmail checkout>`.
- `packages/cli` is `@bulwarkmail/extension-cli`; `action/` is the `bulwarkmail/publish-extension`
  GitHub Action (its `dist/` is committed and rebuilt with `npm run build:cli`).

## Run it locally

```bash
npm ci
cp .env.example .env        # set the session secrets; GitHub OAuth is only needed for sign-in
npx drizzle-kit migrate     # creates data/extensions.db
npm run dev                 # http://localhost:3001
npm run build:scripts && node deploy/dist/worker.cjs   # the worker, with Docker for builds
```

`npx tsx scripts/seed-admin.ts <github-login>` makes a GitHub account a super admin. Without Docker,
set `SANDBOX_RUNNER=off`: extensions without a build step still go through.

Checks, as CI runs them: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run build:scripts`, `npm run build:cli`.

## Deploying

Production runs on mail.rath.li under pm2, behind nginx, as two apps from the same release: the website
(user `extdir-web`) and the worker (user `extdir-worker`). Builds run on a separate VM (VM 111
`extbuild`, 10.10.10.67) that the worker reaches over SSH; see [`deploy/build-vm`](deploy/build-vm).
The one-time server preparation is [`deploy/server-setup.sh`](deploy/server-setup.sh).

To deploy, open **Actions → Deploy → Run workflow** on `main`. The same workflow also deploys every
push to `main` once the repository variable `AUTO_DEPLOY` is set to `true`; while it is unset, pushes
only run CI.

The workflow builds the standalone server and the bundled scripts on the runner, starts that exact
bundle and checks that it answers, then streams it over SSH to `/usr/local/bin/extdir-deploy` on the
server ([`deploy/extdir-deploy.sh`](deploy/extdir-deploy.sh)). The deploy key can run nothing else. On
the server the script:

1. unpacks the bundle into `/opt/extension-directory/releases/<time>-<sha>`,
2. backs up the database to `/opt/extension-directory/backups/`,
3. applies new migrations and the data steps after them ([`deploy/migrate.cjs`](deploy/migrate.cjs),
   [`scripts/post-migrate.ts`](scripts/post-migrate.ts)),
4. points `/opt/extension-directory/current` at the release and reloads pm2
   ([`deploy/ecosystem.config.cjs`](deploy/ecosystem.config.cjs)),
5. checks the site answers, and switches back to the previous release if it does not.

The same workflow has a **rollback** action that switches to the previous release. The server keeps
the last five releases and ten database backups. `.env`, `data/` and `keys/` live in
`/opt/extension-directory` and are shared by every release.

The workflow needs the `production` environment secret `DEPLOY_SSH_KEY` and the repository variables
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_UMAMI_WEBSITE_ID` and `NEXT_PUBLIC_UMAMI_SCRIPT_URL`, which are
built into the page.

After changing `deploy/extdir-deploy.sh`, copy it to `/usr/local/bin/extdir-deploy` on the server by
hand; the workflow does not update the script that receives it.

## Signing keys

Approved bundles are signed with an online Ed25519 key (`keys/signing.pem`, readable by the worker
only). The keys allowed to sign are listed in a keyring signed by an offline root key; the webmail
pins the root key. Both keys are in the vault (collection Agent). To rotate the online key, generate a
new one, sign a new keyring with both keys (the old one `retired`) and import it on the server; the
worker re-signs every version with the new key when it starts. Commands: [`scripts/keys.ts`](scripts/keys.ts).
