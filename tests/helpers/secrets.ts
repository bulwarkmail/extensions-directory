// Secrets for tests are made when the test runs, so the repository holds no
// value that would work as a production secret.
import crypto from "crypto";

/** A new secret on every call, as `openssl rand -hex 32` prints it. */
export const freshSecret = () => crypto.randomBytes(32).toString("hex");
