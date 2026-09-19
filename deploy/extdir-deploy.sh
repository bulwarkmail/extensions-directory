#!/usr/bin/env bash
# Deploys a release of the extension directory on mail.rath.li.
#
# Installed as /usr/local/bin/extdir-deploy and run as the `ubuntu` user
# through a forced command on the deploy key in ~ubuntu/.ssh/authorized_keys:
#
#   command="/usr/local/bin/extdir-deploy",restrict ssh-ed25519 AAAA... extensions-directory deploy
#
# so the key can do nothing but this. The requested action comes in
# SSH_ORIGINAL_COMMAND:
#
#   deploy <sha>   read a release tarball (built by .github/workflows/deploy.yml)
#                  from stdin, back up the database, migrate, switch, check
#   rollback       switch back to the previous release
#   status         print the current release and the last few
#
# Layout under /opt/extension-directory (app files owned by ubuntu):
#   .env, data/            shared across releases
#   releases/<time>-<sha>/ unpacked standalone builds, newest five kept
#   current -> releases/…  what pm2 runs (ecosystem.config.cjs)
#   backups/               database copy taken before each deploy, ten kept
# pm2 runs as root, so only the pm2 calls use sudo.
set -euo pipefail

BASE=/opt/extension-directory
APP=extension-directory
PORT=3004
KEEP_RELEASES=5
KEEP_BACKUPS=10

log() { echo "[extdir-deploy] $*"; }

healthy() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/v1/stats" &&
       curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# Start or reload the pm2 process from the ecosystem file. The first deploy
# replaces the old `npm run start` process with the standalone server.
run_current() {
  local script
  script=$(sudo -n pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(p=>p.name===process.argv[1]);console.log(p?p.pm2_env.pm_exec_path:"")})' "$APP")
  if [[ "$script" == "$BASE/current/server.js" || "$script" == "$BASE"/releases/*/server.js ]]; then
    sudo -n pm2 reload "$BASE/ecosystem.config.cjs" --update-env
  else
    [[ -n "$script" ]] && sudo -n pm2 delete "$APP"
    sudo -n pm2 start "$BASE/ecosystem.config.cjs"
  fi
  sudo -n pm2 save >/dev/null
}

# Point `current` at a release atomically.
switch_to() {
  ln -sfn "$1" "$BASE/current.next"
  mv -Tf "$BASE/current.next" "$BASE/current"
}

# Back to the pre-CI setup (npm run start in $BASE), for a failed first deploy.
restore_legacy() {
  log "restoring the previous npm start process"
  sudo -n pm2 delete "$APP" || true
  sudo -n pm2 start npm --name "$APP" --cwd "$BASE" -- run start -- --port "$PORT"
  sudo -n pm2 save >/dev/null
}

cmd=${SSH_ORIGINAL_COMMAND:-${1:-}}
exec 9>"$BASE/.deploy.lock"
flock -n 9 || { log "another deploy is running"; exit 1; }

case "$cmd" in
  deploy\ *)
    sha=${cmd#deploy }
    [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || { log "bad revision: $sha"; exit 2; }
    stamp=$(date -u +%Y%m%d%H%M%S)
    rel="$BASE/releases/${stamp}-${sha:0:12}"
    mkdir -p "$BASE/releases" "$BASE/backups" "$rel"
    log "unpacking into $rel"
    tar -xz -C "$rel" --no-same-owner
    [[ -f "$rel/server.js" && -f "$rel/deploy/migrate.cjs" ]] || { log "not a release tarball"; rm -rf "$rel"; exit 3; }
    ln -s "$BASE/data" "$rel/data"
    ln -s "$BASE/.env" "$rel/.env"
    echo "$sha" > "$rel/REVISION"

    db=$(sed -n 's/^DATABASE_PATH=//p' "$BASE/.env")
    (cd "$rel" && DATABASE_PATH="$db" node deploy/migrate.cjs --backup "$BASE/backups/extensions-${stamp}.db")

    previous=$(readlink -f "$BASE/current" 2>/dev/null || true)
    cp "$rel/deploy/ecosystem.config.cjs" "$BASE/ecosystem.config.cjs"
    switch_to "$rel"
    run_current
    if healthy; then
      log "live: $(basename "$rel")"
    else
      log "health check failed"
      if [[ -n "$previous" && -d "$previous" ]]; then
        switch_to "$previous"
        run_current
      else
        rm -f "$BASE/current"
        restore_legacy
      fi
      exit 4
    fi

    ls -1dt "$BASE"/releases/*/ | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf
    ls -1t "$BASE"/backups/extensions-*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
    ;;

  rollback)
    cur=$(readlink -f "$BASE/current")
    prev=$(ls -1dt "$BASE"/releases/*/ | sed 's:/$::' | grep -vx "$cur" | head -n 1 || true)
    [[ -n "$prev" ]] || { log "no earlier release to roll back to"; exit 5; }
    switch_to "$prev"
    run_current
    healthy && log "rolled back to $(basename "$prev")" || { log "rolled back, but the health check failed"; exit 4; }
    ;;

  status)
    if [[ -L "$BASE/current" ]]; then
      echo "current: $(basename "$(readlink -f "$BASE/current")")"
    else
      echo "current: none (still the npm start process from before CI)"
    fi
    ls -1dt "$BASE"/releases/*/ 2>/dev/null | head -n "$KEEP_RELEASES" | xargs -r -n1 basename
    ;;

  *)
    echo "usage: deploy <sha> | rollback | status" >&2
    exit 2
    ;;
esac
