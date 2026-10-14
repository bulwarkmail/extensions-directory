#!/usr/bin/env bash
# One-time setup of the build VM (Ubuntu 24.04 cloud image on the rath.li
# Proxmox, internal network). Run as root on the VM:
#
#   sudo bash setup.sh '<worker public key>' <worker host ip>
#
# Afterwards take a Proxmox snapshot named "clean"; the host rolls the VM
# back to it every night (deploy/README.md), so nothing a build leaves
# behind survives.
set -euo pipefail

PUBKEY=${1:?worker public key}
WORKER_IP=${2:?worker host IP}
HERE=$(cd "$(dirname "$0")" && pwd)

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq docker.io tinyproxy ufw

# The build user: may only run extbuild, and only from the worker's host.
id extbuild >/dev/null 2>&1 || useradd --create-home --shell /bin/bash extbuild
usermod -aG docker extbuild
install -d -m 700 -o extbuild -g extbuild /home/extbuild/.ssh
echo "from=\"$WORKER_IP\",command=\"/usr/local/bin/extbuild\",restrict $PUBKEY" > /home/extbuild/.ssh/authorized_keys
chown extbuild:extbuild /home/extbuild/.ssh/authorized_keys
chmod 600 /home/extbuild/.ssh/authorized_keys
install -m 755 "$HERE/extbuild" /usr/local/bin/extbuild
install -d -m 755 /etc/extbuild
install -d -m 770 -o root -g docker /var/lib/extbuild

# The build image, pinned by digest.
docker pull node:22-alpine
docker image inspect --format '{{index .RepoDigests 0}}' node:22-alpine > /etc/extbuild/image
docker run --rm "$(cat /etc/extbuild/image)" node --version

# A proxy that only reaches the npm registry; containers can reach nothing else.
cat > /etc/tinyproxy/filter <<'EOF'
^registry\.npmjs\.org$
EOF
cat > /etc/tinyproxy/tinyproxy.conf <<'EOF'
User tinyproxy
Group tinyproxy
Port 8888
Listen 172.17.0.1
Timeout 120
LogLevel Notice
MaxClients 20
Allow 172.16.0.0/12
Filter "/etc/tinyproxy/filter"
FilterURLs Off
FilterExtended On
FilterDefaultDeny Yes
ConnectPort 443
EOF
systemctl enable tinyproxy
# tinyproxy must start after docker0 exists.
mkdir -p /etc/systemd/system/tinyproxy.service.d
printf '[Unit]\nAfter=docker.service\nRequires=docker.service\n' > /etc/systemd/system/tinyproxy.service.d/after-docker.conf
systemctl daemon-reload
systemctl restart tinyproxy

# Firewall: SSH from the worker and WireGuard admins; the proxy for containers;
# containers may not forward anywhere (DOCKER-USER), only talk to the proxy.
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$WORKER_IP" to any port 22 proto tcp
ufw allow from 10.66.66.0/24 to any port 22 proto tcp
ufw allow in on docker0 from 172.17.0.0/16 to 172.17.0.1 port 8888 proto tcp
if ! grep -q "extbuild: containers" /etc/ufw/after.rules; then
  cat >> /etc/ufw/after.rules <<'EOF'
# extbuild: containers may not reach the network except through the proxy
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -i docker0 -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
-A DOCKER-USER -i docker0 -j DROP
COMMIT
EOF
fi
ufw --force enable
systemctl restart docker

echo "build VM ready; image $(cat /etc/extbuild/image)"
