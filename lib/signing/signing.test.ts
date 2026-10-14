import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { canonicalJson, keyIdOf, rawPublicKey, releaseStatement, signerFromPem, verify, verifyKeyring } from "./index";
import { importKeyring, parseRootKeys, signKeyring } from "./keyring";
import { packageHash } from "@/lib/webmail-compat/vendor/extension-package";

function keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return { pem: privateKey.export({ type: "pkcs8", format: "pem" }) as string, raw: rawPublicKey(publicKey).toString("base64") };
}

describe("release statements", () => {
  it("are canonical JSON the same way the webmail writes it", async () => {
    const value = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" }, u: undefined };
    // The webmail hashes canonicalJson(manifest), a newline and the code;
    // its canonicalJson itself isn't exported.
    const ours = crypto.createHash("sha256").update(`${canonicalJson(value)}\n`).digest("hex");
    expect(ours).toBe(await packageHash(value as never, ""));
    expect(canonicalJson(value)).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it("verify only for the exact slug, version and bundle", () => {
    const k = keypair();
    const signer = signerFromPem(k.pem);
    const base = { slug: "a", version: "1.0.0", kind: "plugin" as const, bundle: { sha256: "ab".repeat(32), size: 10 }, source: { host: "github.com", repo: "o/r", commit: "c".repeat(40), subpath: "" }, approvedAt: "2026-10-14T00:00:00.000Z" };
    const sig = signer.sign(releaseStatement(base));
    expect(verify(k.raw, releaseStatement(base), sig)).toBe(true);
    expect(verify(k.raw, releaseStatement({ ...base, slug: "b" }), sig)).toBe(false);
    expect(verify(k.raw, releaseStatement({ ...base, version: "1.0.1" }), sig)).toBe(false);
    expect(verify(k.raw, releaseStatement({ ...base, bundle: { ...base.bundle, sha256: "cd".repeat(32) } }), sig)).toBe(false);
    expect(signer.keyId).toBe(keyIdOf(Buffer.from(k.raw, "base64")));
  });
});

describe("keyrings", () => {
  const db = () => {
    const d = new Database(":memory:");
    d.exec("create table keyrings (id integer primary key autoincrement, document text not null, created_at integer); create table signing_keys (key_id text primary key, public_key text not null, status text not null, not_before integer not null, not_after integer, created_at integer);");
    return d;
  };

  it("import only when signed by a trusted root and newer than the current one", () => {
    const root = keypair();
    const other = keypair();
    const online = keypair();
    const trusted = parseRootKeys(root.raw);
    const keys = [{ keyId: keyIdOf(Buffer.from(online.raw, "base64")), publicKey: online.raw, status: "active" as const, notBefore: "2026-10-14T00:00:00.000Z", notAfter: null }];
    const doc = signKeyring({ issuedAt: "2026-10-14T10:00:00.000Z", keys }, root.pem);
    expect(verifyKeyring(doc, trusted)).toBe(true);

    const sqlite = db();
    expect(() => importKeyring(sqlite, signKeyring({ issuedAt: "2026-10-14T10:00:00.000Z", keys }, other.pem), trusted)).toThrow(/trusted root/);
    expect(() => importKeyring(sqlite, { ...doc, keys: [{ ...keys[0], status: "revoked" }] }, trusted)).toThrow(/trusted root/);
    importKeyring(sqlite, doc, trusted);
    expect(sqlite.prepare("select key_id, status from signing_keys").all()).toEqual([{ key_id: keys[0].keyId, status: "active" }]);
    expect(() => importKeyring(sqlite, doc, trusted)).toThrow(/not newer/);
  });
});
