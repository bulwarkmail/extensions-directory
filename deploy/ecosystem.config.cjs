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

module.exports = {
  apps: [
    {
      name: "extension-directory",
      cwd: `${BASE}/current`,
      script: "server.js",
      env: {
        ...readEnv(`${BASE}/.env`),
        NODE_ENV: "production",
        PORT: "3004",
        // nginx proxies to 127.0.0.1:3004; nothing else needs the port.
        HOSTNAME: "127.0.0.1",
        // Sandbox build scratch space stays in the shared data folder, not in
        // the release, so it survives deploys.
        SANDBOX_BUILD_TMP: `${BASE}/data/tmp-builds`,
        SANDBOX_BUILD_CACHE: `${BASE}/data/build-cache`,
      },
      max_memory_restart: "500M",
      kill_timeout: 5000,
    },
  ],
};
