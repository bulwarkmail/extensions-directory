// The vendored webmail install checks know what the released webmail offers.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { checkBundle, HIGH_RISK_PERMISSIONS, KNOWN_PERMISSIONS } from "@/lib/webmail-compat";

async function bundle(permissions: string[]) {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({ id: "team-inbox", name: "Team inbox", version: "1.0.0", author: "Test", description: "A test plugin", type: "ui-extension", entrypoint: "index.js", permissions }));
  zip.file("index.js", "module.exports = { activate() {} };\n");
  return zip.generateAsync({ type: "uint8array" });
}

describe("webmail compat", () => {
  it("accepts the permissions webmail 1.19 added", async () => {
    for (const perm of ["directory:read", "email:forward"]) expect(KNOWN_PERMISSIONS).toContain(perm);
    const result = await checkBundle(await bundle(["account:read", "directory:read", "email:write"]), "plugin", "team-inbox");
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts compose:check from webmail 1.20 and marks it high risk", async () => {
    expect(KNOWN_PERMISSIONS).toContain("compose:check");
    expect(HIGH_RISK_PERMISSIONS.has("compose:check")).toBe(true);
    const result = await checkBundle(await bundle(["compose:check", "http:proxy", "ui:settings-section"]), "plugin", "team-inbox");
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("marks forwarding mail as high risk, like the consent dialog", () => {
    expect(HIGH_RISK_PERMISSIONS.has("email:forward")).toBe(true);
  });

  it("marks answering invitations, changing settings and checking links as high risk, like the consent dialog of 1.21", () => {
    expect(HIGH_RISK_PERMISSIONS.has("calendar:respond")).toBe(true);
    expect(HIGH_RISK_PERMISSIONS.has("settings:change")).toBe(true);
    expect(HIGH_RISK_PERMISSIONS.has("links:check")).toBe(true);
  });

  it("accepts optional permissions and a privileged plugin whose crypto:full is optional, like webmail 1.21", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ id: "team-inbox", name: "Team inbox", version: "1.0.0", author: "Test", description: "A test plugin", type: "ui-extension", entrypoint: "index.js", tier: "privileged", permissions: ["ui:toolbar"], optionalPermissions: ["crypto:full", "email:read"] }));
    zip.file("index.js", "module.exports = { activate() {} };\n");
    const result = await checkBundle(await zip.generateAsync({ type: "uint8array" }), "plugin", "team-inbox");
    expect(result.errors).toEqual([]);
    expect((result.manifest as { permissions: string[] }).permissions).toEqual(["ui:toolbar", "crypto:full", "email:read"]);
  });

  async function theme(extra: Record<string, unknown>) {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ id: "letterhead", name: "Letterhead", version: "1.0.0", author: "Test", description: "A test theme", type: "theme", variants: ["light"], apiVersion: 2, tokens: { common: {} }, ...extra }));
    return zip.generateAsync({ type: "uint8array" });
  }

  it("accepts a theme's print tokens and refuses print that isn't an object", async () => {
    const ok = await checkBundle(await theme({ print: { fontFamily: "Georgia, serif", pageMargin: "20mm" } }), "theme", "letterhead");
    expect(ok.errors).toEqual([]);
    expect(ok.ok).toBe(true);
    const bad = await checkBundle(await theme({ print: "Georgia" }), "theme", "letterhead");
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toMatch(/"print" must be an object/);
  });
});
