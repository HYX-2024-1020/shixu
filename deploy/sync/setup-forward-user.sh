#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
IFS= read -r public_key
[[ "$public_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]]
id shixu-access >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/shixu-access --shell /usr/sbin/nologin shixu-access
usermod --password '*' shixu-access
install -d -m 0700 -o shixu-access -g shixu-access /var/lib/shixu-access/.ssh
printf 'restrict,port-forwarding,command="/bin/false",permitopen="127.0.0.1:8790",permitopen="127.0.0.1:8791" %s\n' "$public_key" > /var/lib/shixu-access/.ssh/authorized_keys
chown shixu-access:shixu-access /var/lib/shixu-access/.ssh/authorized_keys
chmod 0600 /var/lib/shixu-access/.ssh/authorized_keys
cat > /etc/ssh/sshd_config.d/90-shixu-access.conf <<'CONFIG'
Match User shixu-access
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:8790 127.0.0.1:8791
    PermitListen none
    PermitTTY no
    X11Forwarding no
    AllowAgentForwarding no
    ForceCommand /bin/false
Match all
CONFIG
sshd -t
systemctl reload ssh
echo 'restricted-forwarding-identity-ready'
