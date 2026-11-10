#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
release=$(realpath "$1")
[[ "$release" == /opt/shixu-cloud/releases/* ]]
cd "$release"
sha256sum --strict -c SHA256SUMS > /dev/null
test -f /etc/shixu-cloud/service.env
id shixu-cloud >/dev/null 2>&1 || useradd --system --home-dir /var/lib/shixu-cloud --shell /usr/sbin/nologin shixu-cloud
install -d -m 0700 -o shixu-cloud -g shixu-cloud /var/lib/shixu-cloud /var/lib/shixu-cloud-ledger
install -d -m 0700 -o shixu-cloud -g shixu-cloud /var/lib/shixu-cloud-backups
install -d -m 0750 -o root -g shixu-cloud /var/lib/shixu-cloud-authority
chown root:shixu-cloud /etc/shixu-cloud/service.env
chown root:shixu-cloud /etc/shixu-cloud /etc/shixu-cloud/runtime.json
chmod 0750 /etc/shixu-cloud
chmod 0640 /etc/shixu-cloud/runtime.json
chmod 0640 /etc/shixu-cloud/service.env
if [ ! -d /opt/shixu-cloud/runtime ]; then
  python3 scripts/reading-prepare-runtime.py /opt/shixu-cloud/runtime --pdf-visual "$release/server/reading/generated-pdf-visual/linux-x64"
fi
cat > /etc/systemd/system/shixu-cloud-reader.service <<UNIT
[Unit]
Description=Shixu isolated material reader
After=network.target
[Service]
Type=simple
User=root
Group=shixu-cloud
RuntimeDirectory=shixu-cloud-reader
RuntimeDirectoryMode=0750
ExecStartPre=/usr/bin/install -d -m 0700 -o root -g root /run/shixu-cloud-staging
ExecStart=/usr/bin/env node $release/server/reading/broker-service.mjs /run/shixu-cloud-reader/reader.sock /opt/shixu-cloud/runtime /run/shixu-cloud-staging --pdf-visual
Restart=on-failure
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/shixu-cloud.service <<UNIT
[Unit]
Description=Shixu private v4 cloud and independent admin listener
After=network.target shixu-cloud-reader.service
Requires=shixu-cloud-reader.service
[Service]
Type=simple
User=shixu-cloud
Group=shixu-cloud
WorkingDirectory=/opt/shixu-cloud/current
Environment=SHIXU_AUTHORITY_FLOOR=/var/lib/shixu-cloud-authority/latest.json
ExecStart=/usr/bin/env node --max-old-space-size=384 --env-file=/etc/shixu-cloud/service.env /opt/shixu-cloud/current/server/reading-runtime.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/shixu-cloud /var/lib/shixu-cloud-ledger
MemoryMax=640M
TasksMax=64
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable shixu-cloud-reader shixu-cloud >/dev/null
previous=$(readlink -f /opt/shixu-cloud/current || true)
systemctl stop shixu-cloud-operations.timer 2>/dev/null || true
systemctl stop shixu-cloud-operations.service 2>/dev/null || true
systemctl stop shixu-cloud
ln -sfn "$release" /opt/shixu-cloud/current
node --env-file=/etc/shixu-cloud/service.env "$release/scripts/cloud-operations-worker.mjs" --seal-floor
systemctl restart shixu-cloud-reader
systemctl restart shixu-cloud
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8790/api/v4/capabilities >/dev/null; then
    ln -sfn "$release" /opt/shixu-cloud/current
    cp "$release/deploy/sync/cloud-tariff.service" /etc/systemd/system/shixu-cloud-tariff.service
    cp "$release/deploy/sync/cloud-tariff.timer" /etc/systemd/system/shixu-cloud-tariff.timer
    systemctl daemon-reload
    systemctl enable --now shixu-cloud-tariff.timer >/dev/null
    cp "$release/deploy/sync/cloud-operations.service" /etc/systemd/system/shixu-cloud-operations.service
    cp "$release/deploy/sync/cloud-operations.timer" /etc/systemd/system/shixu-cloud-operations.timer
    systemctl daemon-reload
    systemctl enable --now shixu-cloud-operations.timer >/dev/null
    echo 'cloud-ready'; exit 0
  fi
  sleep 1
done
if [ -n "$previous" ] && [ "$previous" != "$release" ]; then
  # The ledger writer floor rejects incompatible old binaries. Never restore an
  # old database or remove guards to force a rollback.
  ln -sfn "$previous" /opt/shixu-cloud/current
  systemctl restart shixu-cloud || true
fi
echo 'cloud-start-failed; inspect protected service journal' >&2
exit 1
