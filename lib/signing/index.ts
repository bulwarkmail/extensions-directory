// Directory signatures over approved bundles (docs/rework-plan.md, section 8).
//
// The online signing key lives in a PEM file (SIGNING_KEY_FILE), readable
// only by the worker, which signs as it publishes. The web process only
// reads public keys and stored signatures. An offline root key signs the
// keyring that lists the online keys (scripts/keyring.ts).
import crypto from "crypto";
import fs from "fs";

export const STATEMENT_TYPE = "https://extensions.bulwarkmail.org/release/v1";

/** Same as the webmail's canonicalJson (lib/extension-package.ts): sorted keys, no spaces. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface ReleaseStatement {
  _type: typeof STATEMENT_TYPE;
  slug: string;
  version: string;
  kind: "plugin" | "theme";
  bundle: { sha256: string; size: number };
  source: { host: string; repo: string; commit: string | null; subpath: string };
  approvedAt: string;
}

export function releaseStatement(s: Omit<ReleaseStatement, "_type">): string {
  return canonicalJson({ _type: STATEMENT_TYPE, ...s });
}

/** Raw 32-byte Ed25519 public key of a key object. */
export function rawPublicKey(key: crypto.KeyObject): Buffer {
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  return spki.subarray(spki.length - 32);
}

export function keyIdOf(rawPublic: Uint8Array): string {
  return crypto.createHash("sha256").update(rawPublic).digest("hex").slice(0, 16);
}

export function publicKeyFromRaw(raw: Uint8Array): crypto.KeyObject {
  // SPKI prefix for Ed25519 followed by the 32 raw bytes.
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return crypto.createPublicKey({ key: Buffer.concat([prefix, Buffer.from(raw)]), format: "der", type: "spki" });
}

export interface Signer {
  keyId: string;
  publicKey: string; // base64 raw
  sign(data: string | Uint8Array): string; // base64
}

export function signerFromPem(pem: string): Signer {
  const priv = crypto.createPrivateKey({ key: pem, format: "pem" });
  if (priv.asymmetricKeyType !== "ed25519") throw new Error("Signing key must be Ed25519");
  const raw = rawPublicKey(crypto.createPublicKey(priv));
  return {
    keyId: keyIdOf(raw),
    publicKey: raw.toString("base64"),
    sign: (data) => crypto.sign(null, typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data), priv).toString("base64"),
  };
}

let cached: Signer | null | undefined;
/** The online signer, or null when this process has no key (the web app). */
export function onlineSigner(): Signer | null {
  if (cached !== undefined) return cached;
  const file = process.env.SIGNING_KEY_FILE?.trim();
  cached = file ? signerFromPem(fs.readFileSync(file, "utf8")) : null;
  return cached;
}

export function resetSignerCache(): void {
  cached = undefined;
}

export function verify(rawPublicB64: string, data: string | Uint8Array, signatureB64: string): boolean {
  try {
    const key = publicKeyFromRaw(Buffer.from(rawPublicB64, "base64"));
    return crypto.verify(null, typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** A keyring document as served at /api/v2/keys, before the root signature. */
export interface KeyringBody {
  _type: "https://extensions.bulwarkmail.org/keyring/v1";
  issuedAt: string;
  rootKeyId: string;
  keys: { keyId: string; publicKey: string; status: "active" | "retired" | "revoked"; notBefore: string; notAfter: string | null }[];
}

export interface Keyring extends KeyringBody {
  signature: string;
}

export function keyringPayload(body: KeyringBody): string {
  return canonicalJson(body);
}

export function verifyKeyring(doc: Keyring, rootPublicKeys: Record<string, string>): boolean {
  const root = rootPublicKeys[doc.rootKeyId];
  if (!root) return false;
  const { signature, ...body } = doc;
  return verify(root, keyringPayload(body as KeyringBody), signature);
}
