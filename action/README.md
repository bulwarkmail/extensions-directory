# Publish to Bulwark Extensions

Submits a [Bulwark Webmail](https://bulwarkmail.org) plugin or theme to
[extensions.bulwarkmail.org](https://extensions.bulwarkmail.org) from GitHub
Actions, with trusted publishing: GitHub gives the job a short-lived token,
the directory checks it against the publisher you registered, and no secret is
stored anywhere.

The directory builds the commit the workflow runs for, runs the webmail's
install checks and a code scanner, and queues the version for a person to
review. This action waits for the build and checks and fails the job if they
fail. It never publishes on its own.

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

First add the extension in the [dashboard](https://extensions.bulwarkmail.org/dashboard)
and register this repository and workflow file (and the environment, if you
use one) as a trusted publisher on the extension's page.

## Inputs

| Input | Default | |
|---|---|---|
| `subpath` | | Folder that holds `manifest.json` |
| `dry-run` | `false` | Build and check only; works on branches and pull requests |
| `wait` | `true` | Wait for the build and checks and fail the job on failure |
| `ref` | | Must match the workflow's ref if given |
| `token`, `slug` | | Use an API token instead of trusted publishing |
| `directory-url` | `https://extensions.bulwarkmail.org` | |

## Outputs

`submission-id`, `submission-url`, `status` (`awaiting_review` when it went well).

The source of this action lives in
[bulwarkmail/extensions-directory](https://github.com/bulwarkmail/extensions-directory/tree/main/action);
`dist/index.js` is built from it with `npm run build:cli`.
