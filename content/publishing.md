# Publishing an extension

Every version of a plugin or theme goes through the same steps, however it is submitted:

1. You name a commit (a tag is best). The directory fetches your public repository at exactly that commit.
2. The directory builds the bundle itself. If `package.json` has a `build` script, it runs `npm ci --ignore-scripts` and then `npm run build` without network access, and takes the output from `dist/`, `build/` or the extension's folder. Without a build script, the plain files in the extension's folder are the bundle. Bundles you built yourself (a committed `dist/` or a `.zip`) are never used.
3. It runs the same install checks a Bulwark Webmail runs, and a code scanner.
4. A reviewer looks at the result, including what changed since your previous version, and approves or rejects it. You get an email either way.
5. On approval the bundle is signed by the directory and published. The page of each version shows the commit and the workflow it came from.

Nothing is ever published without a reviewer.

## First time: add the extension

Sign in with GitHub, open the [dashboard](/dashboard) and add the extension: its id (the `id` in `manifest.json`), whether it is a plugin or a theme, and the repository it is built from. Repositories on github.com, gitlab.com and codeberg.org work. For a repository with several extensions, give the folder that holds `manifest.json`.

You can then submit a version from the extension's page in the dashboard. The rest of this page is about submitting from CI instead.

## From GitHub Actions (trusted publishing)

With trusted publishing, GitHub gives your workflow a short-lived token that says which repository, workflow file and environment it is running in. The directory checks that token against the publisher you registered. There is no secret to store, rotate or leak.

1. On the extension's page in the dashboard, under "Publish from CI", add a trusted publisher: the repository, the workflow file (for example `.github/workflows/publish.yml`), and optionally a GitHub environment. By default only tags may publish.
2. Add the workflow to the repository:

```yaml
name: Publish to Bulwark Extensions
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: release
    steps:
      - uses: bulwarkmail/publish-extension@v1
        with:
          subpath: my-plugin   # only for a repository with several extensions
```

3. Push a tag. The job submits the tagged commit, waits for the build and the checks, and fails if they fail. It finishes once the version is waiting for review; the job summary links to the submission.

The release notes of the tag's GitHub release become the version's changelog.

To check pull requests without submitting anything, run a dry run. It builds and checks the commit and reports the result, and nothing is queued for review:

```yaml
on: pull_request
permissions:
  contents: read
  id-token: write
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: bulwarkmail/publish-extension@v1
        with:
          dry-run: true
```

Dry runs from branches and pull requests are allowed even when the publisher only accepts tags. Pull requests from forks get no token from GitHub, so they can't run this step; use `npx @bulwarkmail/extension-cli validate` there instead.

## From anywhere else (API tokens)

For GitLab CI, Forgejo Actions or a script, create an API token on the [tokens page](/dashboard/tokens). A token is limited to the extensions you pick and to what it may do (submit, dry run, read status), and it expires. It is shown once; store it as a CI secret named `BULWARK_EXTENSIONS_TOKEN`.

```sh
npx @bulwarkmail/extension-cli publish --slug my-plugin --ref v1.2.0
npx @bulwarkmail/extension-cli dry-run --slug my-plugin --ref "$CI_COMMIT_SHA"
```

GitLab CI:

```yaml
publish:
  image: node:22
  rules:
    - if: $CI_COMMIT_TAG
  script:
    - npx @bulwarkmail/extension-cli publish --slug my-plugin --ref "$CI_COMMIT_TAG"
```

A token can only submit from the repository and folder set on the extension; it can't point the extension elsewhere.

## Before you submit

`npx @bulwarkmail/extension-cli validate` runs the webmail's manifest and package checks on your folder without contacting the directory.

## The API

The Action and the CLI use the same endpoints; you can call them directly.

```
POST /api/v2/publish            Authorization: Bearer <GitHub OIDC token | bwx_ API token>
POST /api/v2/publish/dry-run    same
GET  /api/v2/submissions/{id}   Authorization: Bearer <pollToken from the response>
```

The body is JSON. With an OIDC token: `subpath` (for monorepos) and optionally `ref`, which must match the workflow's ref; the commit built is always the one the workflow runs for. With an API token: `slug` and `ref`.

The answer is `202` with the submission's `id`, `url`, `statusUrl` and a `pollToken`. Poll `statusUrl` until `status` is `awaiting_review` (built and checked, waiting for a reviewer), `build_failed`, `blocked`, `dry_run_passed` or `dry_run_failed`.

OIDC tokens must have the directory's address as their audience (`https://extensions.bulwarkmail.org`). Each token works once.

## After publishing

From the extension's page in the dashboard you can:

- yank a version: it is no longer offered for new installs and webmails running it are told why, but it can still be downloaded by exact version;
- mark the highest Bulwark version a release works with;
- deprecate the extension, with a message and a replacement;
- edit the description and changelogs (a reviewer approves text changes before they show);
- add maintainers and see downloads per version.

Versions with a pre-release part, like `1.3.0-beta.1`, are published on the beta channel, which webmails only see when an admin turns it on.
