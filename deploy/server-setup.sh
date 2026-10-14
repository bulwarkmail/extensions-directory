#!/usr/bin/env bash
# One-time preparation of mail.rath.li for the publishing rework. Run as
# ubuntu with sudo, before the first deploy of the rework:
#
#   bash deploy/server-setup.sh
#
# Idempotent: running it again changes nothing that is already right.
# What it does:
#   - users extdir-web (website) and extdir-worker (builds, signing, mail) in
#     a group extdir that ubuntu (the deploy user) also joins
#   - data/ and .env readable and writable by that group only
#   - keys/ for the signing key and the build VM SSH key, worker only
#   - an SSH key for the worker to reach the build VM, and the route to it
#   - fonts, so SVG text renders when images are re-encoded
#   - new .env entries with generated secrets (never printed)
#   - an nginx rate limit in front of the publishing API
set -euo pipefail

BASE=/opt/extension-directory
BUILD_VM=10.10.10.67
GATEWAY=62.176.249.202

sudo groupadd -f extdir
id extdir-web >/dev/null 2>&1 || sudo useradd --system --gid extdir --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin extdir-web
id extdir-worker >/dev/null 2>&1 || sudo useradd --system --gid extdir --home-dir /var/lib/extdir-worker --create-home --shell /usr/sbin/nologin extdir-worker
sudo usermod -aG extdir ubuntu

# Shared data: group extdir, new files inherit the group (setgid dirs).
sudo chgrp -R extdir "$BASE/data" "$BASE/backups"
sudo chmod -R g+rwX,o-rwx "$BASE/data"
sudo find "$BASE/data" -type d -exec chmod g+s {} +
sudo install -d -m 2770 -o ubuntu -g extdir "$BASE/data/staging" "$BASE/data/tmp-builds" "$BASE/data/build-cache"
sudo chgrp extdir "$BASE/.env" && sudo chmod 640 "$BASE/.env"

# Keys only the worker reads.
sudo install -d -m 700 -o extdir-worker -g extdir "$BASE/keys"
if ! sudo test -f "$BASE/keys/buildvm_ed25519"; then
  sudo -u extdir-worker ssh-keygen -q -t ed25519 -N "" -C "extdir-worker@mail.rath.li" -f "$BASE/keys/buildvm_ed25519"
fi
echo "worker public key for the build VM:"
sudo cat "$BASE/keys/buildvm_ed25519.pub"

# Route to the build VM on the internal network (as for VM 106).
if [[ ! -f /etc/netplan/62-extbuild-route.yaml ]]; then
  sudo tee /etc/netplan/62-extbuild-route.yaml >/dev/null <<EOF
network:
  version: 2
  ethernets:
    eth0:
      routes:
        - to: $BUILD_VM/32
          via: $GATEWAY
EOF
  sudo chmod 600 /etc/netplan/62-extbuild-route.yaml
  sudo ip route replace "$BUILD_VM/32" via "$GATEWAY" || true
fi

sudo apt-get install -yq fonts-dejavu-core fonts-noto-core >/dev/null

# New settings. Secrets are generated here and never shown.
add_env() { sudo grep -q "^$1=" "$BASE/.env" || echo "$1=$2" | sudo tee -a "$BASE/.env" >/dev/null; }
add_env TOKEN_PEPPER "$(openssl rand -hex 32)"
add_env IP_HASH_SALT "$(openssl rand -hex 32)"
add_env EXTDIR_WEB_USER extdir-web
add_env EXTDIR_WORKER_USER extdir-worker
add_env EXTDIR_GROUP extdir
add_env SANDBOX_RUNNER ssh
add_env SANDBOX_SSH_HOST "extbuild@$BUILD_VM"
add_env SANDBOX_SSH_KEY "$BASE/keys/buildvm_ed25519"
add_env SANDBOX_SSH_KNOWN_HOSTS "$BASE/keys/buildvm_known_hosts"
add_env SIGNING_KEY_FILE "$BASE/keys/signing.pem"
add_env EXTENSIONS_ROOT_KEYS SyGlNKHBY4T7Z7BmDP80G8Eh58yn6W32SpKUHpRzHk4=
add_env MAIL_FROM '"Bulwark Extensions <noreply@bulwarkmail.org>"'

# Rate limit for the publishing API (the app limits too; this catches floods early).
if [[ ! -f /etc/nginx/conf.d/extdir-ratelimit.conf ]]; then
  echo 'limit_req_zone $binary_remote_addr zone=extdir_publish:10m rate=30r/m;' | sudo tee /etc/nginx/conf.d/extdir-ratelimit.conf >/dev/null
fi
echo
echo "Add to the extensions.bulwarkmail.org server block, then nginx -t && systemctl reload nginx:"
cat <<'EOF'
    location ~ ^/api/v2/(publish|extensions/[^/]+/reports) {
        limit_req zone=extdir_publish burst=10 nodelay;
        client_max_body_size 64k;
        proxy_pass http://127.0.0.1:3004;
        include /etc/nginx/proxy_params;
    }
EOF
