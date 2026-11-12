// Which stored secret a credential sends to which server is part of what a
// webmail grants, and so is a setting that stops being a secret: the webmail
// asks the admin about both on an update. An update that keeps every server but
// changes either has to give the reviewer a highlighted line that names the
// server and the setting before and after, and the grant section shows where
// each credential's secret goes.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { diffBundles } from "@/lib/pipeline/diff";
import { grantOf } from "@/lib/webmail-compat";
import { SubmissionDetails } from "@/components/submission-details";

const manifest = (version: string, extra: Record<string, unknown>): Record<string, unknown> => ({
  id: "relay", name: "Relay", version, author: "Test", description: "Sends things on.", type: "ui-extension", entrypoint: "index.js", ...extra,
});
/** Two admin credentials: a mail service's key, and the plugin's own service with `own` merged in. */
const twoServices = (version: string, own: Record<string, unknown>) => manifest(version, {
  permissions: ["http:proxy"],
  configSchema: {
    serviceKey: { type: "secret", label: "Mail service key" },
    ownKey: { type: "secret", label: "Own service key" },
    ownUser: { type: "string", label: "Own service user" },
  },
  credentials: {
    service: { label: "Mail service", scope: "admin", inject: { type: "bearer" }, secretKey: "serviceKey", origin: "https://mail-service.example" },
    own: { label: "Own service", scope: "admin", inject: { type: "basic" }, origin: "https://own.example", ...own },
  },
});
const files = new Map([["index.js", new TextEncoder().encode("module.exports = {};\n")]]);
const submissionFor = (before: Record<string, unknown> | null, after: Record<string, unknown>) => ({
  id: "s1", status: "awaiting_review", slug: "relay", version: String(after.version), manifestSnapshot: after,
  diffSummary: diffBundles(before ? { version: String(before.version), files, manifest: before } : null, { files, manifest: after }),
  sourceHost: "github.com", githubRepo: "dana/relay", githubTag: `v${String(after.version)}`, subpath: "", submittedAt: new Date(), submittedVia: "web",
}) as never;
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, "\"").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&");

/** The highlighted lines under "Changes" for an update from `before` to `after`, as text. */
function changeLines(before: Record<string, unknown> | null, after: Record<string, unknown>): string[] {
  const html = renderToStaticMarkup(SubmissionDetails({ s: submissionFor(before, after) }));
  const changes = html.slice(html.indexOf(">Changes "));
  return [...changes.matchAll(/class="bw-note bw-note-warning">(.*?)<\/p>/g)].map((m) => text(m[1]));
}

describe("review lines for credentials that keep their server", () => {
  it("control: a credential on a new server gets a line", () => {
    const before = twoServices("1.0.0", { secretKey: "ownKey" });
    const after = twoServices("1.1.0", { secretKey: "ownKey" });
    (after.credentials as Record<string, unknown>).extra = { label: "Extra", scope: "admin", inject: { type: "bearer" }, secretKey: "ownKey", origin: "https://new.example" };
    expect(changeLines(before, after).join("\n")).toContain("https://new.example");
  });

  it("control: a new label moves nothing and gets no line", () => {
    const after = twoServices("1.1.0", { secretKey: "ownKey" });
    (after.credentials as Record<string, { label: string }>).own.label = "Own service, renamed";
    expect(changeLines(twoServices("1.0.0", { secretKey: "ownKey" }), after)).toEqual([]);
  });

  it("names the server and both settings when another stored secret goes to the same server", () => {
    const lines = changeLines(twoServices("1.0.0", { secretKey: "ownKey" }), twoServices("1.1.0", { secretKey: "serviceKey" }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("https://own.example");
    expect(lines[0]).toContain("\"serviceKey\"");
    expect(lines[0]).toContain("\"ownKey\"");
    expect(lines[0].indexOf("\"serviceKey\"")).toBeLessThan(lines[0].indexOf("\"ownKey\""));
  });

  it("names both settings when another stored secret goes as the user name", () => {
    const lines = changeLines(twoServices("1.0.0", { secretKey: "ownKey", usernameKey: "ownUser" }), twoServices("1.1.0", { secretKey: "ownKey", usernameKey: "serviceKey" }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("user name in setting \"serviceKey\"");
    expect(lines[0]).toContain("user name in setting \"ownUser\"");
    expect(lines[0]).toContain("https://own.example");
  });

  it("names a setting that stops being a secret", () => {
    const before = manifest("1.0.0", { permissions: ["http:proxy"], configSchema: { apiKey: { type: "secret", label: "Key" } }, credentials: { c: { label: "C", scope: "admin", inject: { type: "bearer" }, secretKey: "apiKey", origin: "https://api.example" } } });
    const after = manifest("1.1.0", { permissions: ["http:proxy"], configSchema: { apiKey: { type: "string", label: "Key" }, key2: { type: "secret", label: "Key 2" } }, credentials: { c: { label: "C", scope: "admin", inject: { type: "bearer" }, secretKey: "key2", origin: "https://api.example" } } });
    const lines = changeLines(before, after);
    expect(lines.some((l) => l.includes("\"apiKey\"") && /no longer secret/i.test(l))).toBe(true);
  });

  it("gives no secret line when a plain setting stays plain or a secret stays secret", () => {
    const same = twoServices("1.1.0", { secretKey: "ownKey", usernameKey: "ownUser" });
    expect(diffBundles({ version: "1.0.0", files, manifest: twoServices("1.0.0", { secretKey: "ownKey", usernameKey: "ownUser" }) }, { files, manifest: same })).toMatchObject({ credentialsChanged: [], formerSecrets: [] });
  });
});

describe("the grant section", () => {
  it("shows which stored secret each credential sends where", () => {
    const html = text(renderToStaticMarkup(SubmissionDetails({ s: submissionFor(null, twoServices("1.0.0", { secretKey: "ownKey", usernameKey: "ownUser" })) })));
    const grant = html.slice(html.indexOf("What a webmail grants this version"), html.indexOf("Changes "));
    expect(grant).toContain("the secret in setting \"serviceKey\", sent to https://mail-service.example");
    expect(grant).toContain("the secret in setting \"ownKey\" with the user name in setting \"ownUser\", sent to https://own.example");
  });
});

describe("binding lines as the webmail counts them", () => {
  // The lines the webmail's credentialBindings (lib/admin/extension-grants.ts) gives for the same manifest.
  it("match for every kind of credential", () => {
    const m = manifest("1.0.0", {
      permissions: ["http:proxy"],
      configSchema: { k: { type: "secret", label: "K" }, u: { type: "string", label: "U" }, base: { type: "string", label: "Base", default: "https://llm.example/v1" } },
      credentials: {
        fixed: { label: "Fixed", scope: "admin", inject: { type: "bearer" }, secretKey: "k", origin: "https://fixed.example" },
        basic: { label: "Basic", scope: "admin", inject: { type: "basic" }, secretKey: "k", usernameKey: "u", origin: "https://basic.example" },
        nouser: { label: "Header", scope: "admin", inject: { type: "header", name: "X-API-Key" }, secretKey: "k", usernameKey: "u", origin: "https://header.example" },
        none: { label: "None", scope: "admin", inject: { type: "none" }, secretKey: "k", origin: "https://none.example" },
        setting: { label: "Setting", scope: "admin", inject: { type: "bearer" }, secretKey: "k", originKey: "base" },
        mine: { label: "Mine", scope: "user", inject: { type: "basic" }, origin: "https://mine.example" },
        anywhere: { label: "Anywhere", scope: "user", inject: { type: "basic" } },
      },
    });
    expect(grantOf(m).credentialBindings).toEqual([
      "fixed: the secret in setting \"k\", sent to https://fixed.example",
      "basic: the secret in setting \"k\" with the user name in setting \"u\", sent to https://basic.example",
      "nouser: the secret in setting \"k\", sent to https://header.example",
      "none: no secret, sent to https://none.example",
      "setting: the secret in setting \"k\", sent to the server in setting \"base\"",
      "mine: the user's own account, sent to https://mine.example",
      "anywhere: the user's own account, sent to the server the user enters",
    ]);
  });

  it("counts a renamed credential and a new first-version credential as new, like the webmail", () => {
    const before = twoServices("1.0.0", { secretKey: "ownKey" });
    const after = twoServices("1.1.0", { secretKey: "ownKey" });
    const creds = after.credentials as Record<string, unknown>;
    creds.renamed = creds.own;
    delete creds.own;
    expect(diffBundles({ version: "1.0.0", files, manifest: before }, { files, manifest: after }).credentialsChanged).toEqual([
      { credential: "renamed", before: null, after: "the secret in setting \"ownKey\", sent to https://own.example" },
    ]);
    expect(diffBundles(null, { files, manifest: before }).credentialsChanged.map((c) => c.credential)).toEqual(["service", "own"]);
  });
});
