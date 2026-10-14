# @bulwarkmail/extension-cli

Validate and publish [Bulwark Webmail](https://bulwarkmail.org) extensions to
[extensions.bulwarkmail.org](https://extensions.bulwarkmail.org).

```sh
npx @bulwarkmail/extension-cli validate ./my-plugin
BULWARK_EXTENSIONS_TOKEN=bwx_… npx @bulwarkmail/extension-cli publish --slug my-plugin --ref v1.2.0
BULWARK_EXTENSIONS_TOKEN=bwx_… npx @bulwarkmail/extension-cli dry-run --slug my-plugin --ref main
npx @bulwarkmail/extension-cli status <submission id> --poll-token bwp_…
```

- `validate` checks a folder offline: the manifest, the files the directory
  would put in the bundle, the install checks a Bulwark Webmail runs, and the
  code scanner. It exits with 1 when the directory would refuse the bundle.
- `publish` submits the commit behind `--ref` for review and waits until the
  build and checks are done. It exits with 1 when they fail.
- `dry-run` does the same without creating anything to review.

Credentials: an API token from the dashboard in `BULWARK_EXTENSIONS_TOKEN`, or,
in a GitHub Actions job with `permissions: id-token: write`, a trusted
publisher (no token needed; pass `--subpath` for a monorepo instead of
`--slug`). See [Publishing](https://extensions.bulwarkmail.org/publishing).

Every version is built by the directory from your repository and reviewed by
a person before it is published.
