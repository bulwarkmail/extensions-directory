// pm2 process definition for extensions.bulwarkmail.org. Installed on the
// server as /opt/extension-directory/ecosystem.config.cjs by
// deploy/extdir-deploy.sh. It runs the Next.js standalone server of the
// release that /opt/extension-directory/current points to, with the
// variables from /opt/extension-directory/.env (read on every start or
// reload, so a changed .env takes effect on the next deploy or
// `pm2 reload ecosystem.config.cjs --update-env`).
const fs = require("fs");

const BASE = "/opt/extension-directory";

function readEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

// Two apps from the same release, each under its own unprivileged user in
// the group "extdir" (deploy/README.md sets them up):
//   extension-directory         the website and API (extdir-web)
//   extension-directory-worker  builds, image re-encoding, signing, mail
//                               (extdir-worker, the only one that can read
//                               the signing key and the build VM's SSH key)
const env = readEnv(`${BASE}/.env`);
const shared = {
  ...env,
  NODE_ENV: "production",
  STAGING_DIR: `${BASE}/data/staging`,
  SANDBOX_BUILD_TMP: `${BASE}/data/tmp-builds`,
  SANDBOX_BUILD_CACHE: `${BASE}/data/build-cache`,
};
// Secrets only the worker needs never reach the web process.
const WORKER_ONLY = ["SIGNING_KEY_FILE", "SMTP_PASSWORD", "SANDBOX_SSH_KEY"];
const webEnv = Object.fromEntries(Object.entries(shared).filter(([k]) => !WORKER_ONLY.includes(k)));

module.exports = {
  apps: [
    {
      name: "extension-directory",
      cwd: `${BASE}/current`,
      script: "server.js",
      uid: env.EXTDIR_WEB_USER || undefined,
      gid: env.EXTDIR_GROUP || undefined,
      env: {
        ...webEnv,
        PORT: "3004",
        // nginx proxies to 127.0.0.1:3004; nothing else needs the port.
        HOSTNAME: "127.0.0.1",
      },
      max_memory_restart: "500M",
      kill_timeout: 5000,
    },
    {
      name: "extension-directory-worker",
      cwd: `${BASE}/current`,
      script: "deploy/dist/worker.cjs",
      uid: env.EXTDIR_WORKER_USER || undefined,
      gid: env.EXTDIR_GROUP || undefined,
      env: {
        ...shared,
        SIGNING_KEY_FILE: env.SIGNING_KEY_FILE || `${BASE}/keys/signing.pem`,
      },
      max_memory_restart: "700M",
      // Let a running build finish its current step before a reload.
      kill_timeout: 30000,
    },
  ],
};
