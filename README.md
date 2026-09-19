# Bulwark Extensions

The directory of plugins and themes for [Bulwark Webmail](https://bulwarkmail.org), live at
[extensions.bulwarkmail.org](https://extensions.bulwarkmail.org). Authors sign in with GitHub and submit a
public repository; the directory fetches it, scans the code and queues it for a reviewer. Bulwark's admin
console installs extensions from here.

Next.js 16 (App Router, standalone output), SQLite through better-sqlite3 and Drizzle, iron-session for
author and admin sessions. The design follows the Bulwark website's "Flat fields" system: the tokens and
`.bw-*` classes in `app/globals.css` are copied from
[bulwarkmail/website](https://github.com/bulwarkmail/website) and must stay in step with it.

## Run it locally

```bash
npm ci
cp .env.example .env        # set the session secrets; GitHub OAuth is only needed for sign-in
npx drizzle-kit migrate     # creates data/extensions.db
npx tsx scripts/seed-extensions.ts   # optional: sample plugins and themes from ../plugins and ../themes
npm run dev                 # http://localhost:3001
```

`npx tsx scripts/seed-admin.ts <github-login>` makes a GitHub account a super admin.

Checks, as CI runs them: `npm run lint`, `npm run typecheck`, `npm run build`.

## Deploying

Production runs on mail.rath.li under pm2, behind nginx. To deploy, open
**Actions → Deploy → Run workflow** on `main`. The same workflow also deploys every push to `main` once
the repository variable `AUTO_DEPLOY` is set to `true`; while it is unset, pushes only run CI.

The workflow builds the standalone server on the runner, starts that exact bundle and checks that it
answers, then streams it over SSH to `/usr/local/bin/extdir-deploy` on the server
([`deploy/extdir-deploy.sh`](deploy/extdir-deploy.sh)). The deploy key can run nothing else. On the
server the script:

1. unpacks the bundle into `/opt/extension-directory/releases/<time>-<sha>`,
2. backs up the database to `/opt/extension-directory/backups/`,
3. applies new migrations ([`deploy/migrate.cjs`](deploy/migrate.cjs)),
4. points `/opt/extension-directory/current` at the release and reloads pm2
   ([`deploy/ecosystem.config.cjs`](deploy/ecosystem.config.cjs)),
5. checks the site answers, and switches back to the previous release if it does not.

The same workflow has a **rollback** action that switches to the previous release. The server keeps
the last five releases and ten database backups. `.env` and `data/` live in `/opt/extension-directory`
and are shared by every release.

The workflow needs the `production` environment secret `DEPLOY_SSH_KEY` and the repository variables
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_UMAMI_WEBSITE_ID` and `NEXT_PUBLIC_UMAMI_SCRIPT_URL`, which are
built into the page.

After changing `deploy/extdir-deploy.sh`, copy it to `/usr/local/bin/extdir-deploy` on the server by
hand; the workflow does not update the script that receives it.
