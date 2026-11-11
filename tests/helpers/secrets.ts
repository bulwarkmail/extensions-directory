// Secrets for tests are made when the test runs, so the repository holds no
// value that would work as a production secret.
import crypto from "crypto";
import { vi } from "vitest";

/** A new secret on every call, as `openssl rand -hex 32` prints it. */
export const freshSecret = () => crypto.randomBytes(32).toString("hex");

export const SECRET_KEYS = ["AUTHOR_SESSION_SECRET", "TOKEN_PEPPER", "IP_HASH_SALT"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/**
 * Gives the test the three keys a production server needs, each made for this
 * call. `given` sets single ones to something else (an empty string for a key
 * that is missing). vi.unstubAllEnvs() takes them away again.
 */
export function stubSecrets(given: Partial<Record<SecretKey, string>> = {}): void {
  for (const key of SECRET_KEYS) vi.stubEnv(key, given[key] ?? freshSecret());
}
