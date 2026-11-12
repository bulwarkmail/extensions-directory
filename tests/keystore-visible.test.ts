// `keystore` lets a plugin ask to use the certificates on someone's computer. It's listed
// as optional, so a webmail that doesn't know it can still install the plugin, and an
// optional permission is granted like any other: nothing here may leave it out.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { validateManifest } from "@/lib/manifest";
import { diffBundles } from "@/lib/pipeline/diff";
import { scanBundle } from "@/lib/scanner";
import { checkBundle, grantOf, HIGH_RISK_PERMISSIONS, KNOWN_PERMISSIONS, permissionText } from "@/lib/webmail-compat";

const MANIFEST = {
  id: "smime",
  name: "S/MIME",
  version: "1.5.0",
  description: "Signs and decrypts",
  author: "Test",
  type: "ui-extension",
  entrypoint: "index.js",
  tier: "privileged",
  permissions: ["crypto:full", "email:read"],
  optionalPermissions: ["keystore"],
};

const manifestOf = (overrides: Record<string, unknown> = {}) => ({ ...MANIFEST, ...overrides });

describe("what the directory lists for the manifest", () => {
  it("counts optional permissions", () => {
    expect(grantOf(manifestOf()).permissions).toEqual(["crypto:full", "email:read", "keystore"]);
  });

  it("does not list twice what is both", () => {
    expect(grantOf(manifestOf({ permissions: ["crypto:full", "keystore"], optionalPermissions: ["keystore"] })).permissions).toEqual(["crypto:full", "keystore"]);
  });

  it("leaves keystore out of an untrusted plugin, as the webmail does", () => {
    expect(grantOf(manifestOf({ tier: undefined, permissions: ["email:read"] })).permissions).toEqual(["email:read"]);
    expect(grantOf(manifestOf({ tier: "untrusted", permissions: ["email:read"] })).permissions).toEqual(["email:read"]);
  });

  it("refuses junk at submission", () => {
    expect(validateManifest(manifestOf({ optionalPermissions: "keystore" })).ok).toBe(false);
    expect(validateManifest(manifestOf({ optionalPermissions: [7, "email:send"] })).ok).toBe(false);
    expect(validateManifest(manifestOf()).ok).toBe(true);
  });
});

describe("the review diff", () => {
  const files = new Map([["index.js", new TextEncoder().encode("x")]]);
  const previous = (overrides: Record<string, unknown>) => ({ version: "1.4.0", files, manifest: manifestOf({ version: "1.4.0", ...overrides }) });
  const next = (overrides: Record<string, unknown>) => ({ files, manifest: manifestOf(overrides) });

  it("names an optional permission an update adds, and flags keystore", () => {
    const diff = diffBundles(previous({ permissions: ["crypto:full"], optionalPermissions: [] }), next({ permissions: ["crypto:full"], optionalPermissions: ["keystore"] }));
    expect(diff.permissionsAdded).toEqual(["keystore"]);
    expect(diff.optionalPermissionsAdded).toEqual(["keystore"]);
    expect(diff.keystoreAdded).toBe(true);
  });

  it("does not flag keystore that only moved to optional", () => {
    const diff = diffBundles(previous({ permissions: ["crypto:full", "keystore"], optionalPermissions: [] }), next({ permissions: ["crypto:full"], optionalPermissions: ["keystore"] }));
    expect(diff.permissionsAdded).toEqual([]);
    expect(diff.permissionsRemoved).toEqual([]);
    expect(diff.keystoreAdded).toBe(false);
  });

  it("flags it on a first version too", () => {
    expect(diffBundles(null, next({})).keystoreAdded).toBe(true);
  });

  it("does not flag another new permission", () => {
    const diff = diffBundles(previous({ permissions: ["crypto:full"], optionalPermissions: [] }), next({ permissions: ["crypto:full", "email:read"], optionalPermissions: [] }));
    expect(diff.permissionsAdded).toEqual(["email:read"]);
    expect(diff.keystoreAdded).toBe(false);
  });
});

describe("the code scan", () => {
  const scanOf = async (code: string) => {
    const result = validateManifest(MANIFEST);
    if (!result.ok) throw new Error(result.error);
    return scanBundle({ files: new Map([["index.js", new TextEncoder().encode(code)]]) }, result.manifest);
  };

  it.each([
    ["through parent", "window.parent.bulwarkDesktop.keystore.sign(id, data, scheme)"],
    ["through top, by index", "top['bulwarkDesktop'].keystore.list()"],
    ["a plain read", "const d = bulwarkDesktop;"],
  ])("blocks reaching the desktop bridge %s", async (_name, code) => {
    const report = await scanOf(code);
    expect(report.blocked).toBe(true);
    expect(report.findings.map((finding) => finding.rule)).toContain("js-desktop-bridge");
  });

  it("leaves api.keystore alone", async () => {
    const report = await scanOf("await api.keystore.list({ quiet: true });");
    expect(report.findings.map((finding) => finding.rule)).not.toContain("js-desktop-bridge");
    expect(report.blocked).toBe(false);
  });
});

describe("the vendored webmail", () => {
  async function bundle() {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(MANIFEST));
    zip.file("index.js", "module.exports = { activate() {} };\n");
    return zip.generateAsync({ type: "uint8array" });
  }

  it("knows it, marks it high risk and has its text", () => {
    expect(KNOWN_PERMISSIONS).toContain("keystore");
    expect(HIGH_RISK_PERMISSIONS.has("keystore")).toBe(true);
    expect(permissionText("keystore")?.title).toMatch(/certificates/i);
  });

  it("takes a privileged plugin that lists it as optional", async () => {
    const result = await checkBundle(await bundle(), "plugin", "smime");
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect((result.manifest as { permissions: string[] }).permissions).toContain("keystore");
  });
});
