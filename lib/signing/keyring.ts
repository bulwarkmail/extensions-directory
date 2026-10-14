// The keyring: which online keys sign bundles, signed by an offline root key.
// Built and signed on a workstation (scripts/keys.ts keyring), imported on
// the server (scripts/keys.ts import), which only accepts a document signed
// by a root key it trusts (EXTENSIONS_ROOT_KEYS).
import crypto from "crypto";
import type Database from "better-sqlite3";
import { keyIdOf, keyringPayload, rawPublicKey, verifyKeyring, type Keyring, type KeyringBody } from "./index";

export function parseRootKeys(env: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (env ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const raw = Buffer.from(part, "base64");
    if (raw.length !== 32) throw new Error("EXTENSIONS_ROOT_KEYS holds base64 raw Ed25519 public keys, comma-separated");
    out[keyIdOf(raw)] = part;
  }
  return out;
}

export function signKeyring(body: Omit<KeyringBody, "_type" | "rootKeyId">, rootPem: string): Keyring {
  const priv = crypto.createPrivateKey({ key: rootPem, format: "pem" });
  if (priv.asymmetricKeyType !== "ed25519") throw new Error("The root key must be Ed25519");
  const rootKeyId = keyIdOf(rawPublicKey(crypto.createPublicKey(priv)));
  const full: KeyringBody = { _type: "https://extensions.bulwarkmail.org/keyring/v1", rootKeyId, ...body };
  return { ...full, signature: crypto.sign(null, Buffer.from(keyringPayload(full), "utf8"), priv).toString("base64") };
}

/** Store a keyring after checking its root signature and that it is newer than the current one. */
export function importKeyring(sqlite: Database.Database, doc: Keyring, rootKeys: Record<string, string>): void {
  if (doc._type !== "https://extensions.bulwarkmail.org/keyring/v1") throw new Error("Not a keyring document");
  if (!verifyKeyring(doc, rootKeys)) throw new Error("The keyring is not signed by a trusted root key");
  const current = sqlite.prepare("select document from keyrings order by id desc limit 1").get() as { document: string } | undefined;
  if (current && Date.parse(JSON.parse(current.document).issuedAt) >= Date.parse(doc.issuedAt)) throw new Error("The keyring is not newer than the one in use");
  for (const k of doc.keys) {
    if (Buffer.from(k.publicKey, "base64").length !== 32 || keyIdOf(Buffer.from(k.publicKey, "base64")) !== k.keyId) throw new Error(`Key ${k.keyId} does not match its public key`);
  }
  sqlite.transaction(() => {
    sqlite.prepare("insert into keyrings (document, created_at) values (?, unixepoch())").run(JSON.stringify(doc));
    const upsert = sqlite.prepare(`insert into signing_keys (key_id, public_key, status, not_before, not_after, created_at) values (?, ?, ?, ?, ?, unixepoch())
      on conflict(key_id) do update set status = excluded.status, not_before = excluded.not_before, not_after = excluded.not_after`);
    for (const k of doc.keys) upsert.run(k.keyId, k.publicKey, k.status, Math.floor(Date.parse(k.notBefore) / 1000), k.notAfter ? Math.floor(Date.parse(k.notAfter) / 1000) : null);
  })();
}
