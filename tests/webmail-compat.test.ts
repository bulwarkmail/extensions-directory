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

  it("marks forwarding mail as high risk, like the consent dialog", () => {
    expect(HIGH_RISK_PERMISSIONS.has("email:forward")).toBe(true);
  });
});
