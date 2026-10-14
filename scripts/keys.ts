// Signing key tooling, bundled to deploy/dist/keys.cjs (npm run build:scripts).
//
// On a workstation, with the keys in the vault (never in files or output):
//
//   vw store "Bulwark extensions – root signing key" notes --create --collection Agent -- node deploy/dist/keys.cjs generate
//   vw store "Bulwark extensions – online signing key" notes --create --collection Agent -- node deploy/dist/keys.cjs generate
//   vw exec --file k="vault://Bulwark extensions – online signing key/notes" -- node deploy/dist/keys.cjs public "{{file:k}}"
//   vw exec --file root="vault://Bulwark extensions – root signing key/notes" -- \
//     node deploy/dist/keys.cjs keyring --root "{{file:root}}" --key <online public key>:active --out keyring.json
//
// On the server (DATABASE_PATH and EXTENSIONS_ROOT_KEYS from .env):
//
//   node deploy/dist/keys.cjs import keyring.json
import crypto from "crypto";
import fs from "fs";
import Database from "better-sqlite3";
import { keyIdOf, rawPublicKey } from "../lib/signing";
import { importKeyring, parseRootKeys, signKeyring } from "../lib/signing/keyring";

function flag(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}` && args[i + 1]) out.push(args[++i]);
  return out;
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "generate": {
      // Prints the private key: only ever run this into `vw store`.
      const { privateKey } = crypto.generateKeyPairSync("ed25519");
      process.stdout.write(privateKey.export({ type: "pkcs8", format: "pem" }) as string);
      return;
    }
    case "public": {
      const pem = fs.readFileSync(args[0], "utf8");
      const raw = rawPublicKey(crypto.createPublicKey(crypto.createPrivateKey(pem)));
      console.log(`keyId ${keyIdOf(raw)}\npublicKey ${raw.toString("base64")}`);
      return;
    }
    case "keyring": {
      const [rootFile] = flag(args, "root");
      const [out] = flag(args, "out");
      if (!rootFile || !out) throw new Error("keyring --root <pem> --key <publicKey>[:active|retired|revoked] ... --out <file>");
      const now = new Date().toISOString();
      const keys = flag(args, "key").map((k) => {
        const [publicKey, status = "active"] = k.split(":");
        const raw = Buffer.from(publicKey, "base64");
        if (raw.length !== 32) throw new Error(`${publicKey} is not a raw Ed25519 public key`);
        if (!["active", "retired", "revoked"].includes(status)) throw new Error(`Unknown status ${status}`);
        return { keyId: keyIdOf(raw), publicKey, status: status as "active", notBefore: now, notAfter: status === "active" ? null : now };
      });
      if (!keys.some((k) => k.status === "active")) throw new Error("A keyring needs one active key");
      const doc = signKeyring({ issuedAt: now, keys }, fs.readFileSync(rootFile, "utf8"));
      fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
      console.log(`wrote ${out}: root ${doc.rootKeyId}, keys ${keys.map((k) => `${k.keyId} ${k.status}`).join(", ")}`);
      return;
    }
    case "import": {
      const dbPath = process.env.DATABASE_PATH;
      if (!dbPath) throw new Error("DATABASE_PATH is not set");
      const sqlite = new Database(dbPath);
      try {
        importKeyring(sqlite, JSON.parse(fs.readFileSync(args[0], "utf8")), parseRootKeys(process.env.EXTENSIONS_ROOT_KEYS));
      } finally {
        sqlite.close();
      }
      console.log("keyring imported");
      return;
    }
    default:
      console.log("Usage: keys.cjs generate | public <pem> | keyring --root <pem> --key <pub>[:status] --out <file> | import <file>");
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
