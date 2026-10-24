#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run only after inspecting the host. This installs a loopback-only staging API.
# Runtime installation, firewall, DNS and HTTPS are deliberately separate steps.
if [[ $EUID -ne 0 || $# -ne 1 ]]; then
  echo 'Usage: sudo bash deploy/sync/install.sh /absolute/path/to/release' >&2
  exit 1
fi
release=$(realpath "$1")
cd "$release"
sha256sum --strict -c SHA256SUMS
node -e 'if (+process.versions.node.split(".")[0] !== 24) throw Error("Node.js 24 required")'
release_id=$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync("release.json", "utf8")).releaseId)')
[[ $release_id =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid release ID' >&2; exit 1; }
base=/opt/shixu-sync
target="$base/releases/$release_id"
unit=/etc/systemd/system/shixu-sync.service
if [[ -e "$unit" ]] && ! cmp -s "$unit" deploy/sync/shixu-sync.service &&
  ! cmp -s "$unit" "$base/current/deploy/sync/shixu-sync.service"; then
  echo 'Existing systemd unit differs; inspect it before changing this service.' >&2
  exit 1
fi
[[ ! -e "$target" ]] || { echo 'This release is already installed; refusing to overwrite it.' >&2; exit 1; }
if ! id shixu-sync >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/shixu-sync --shell /usr/sbin/nologin shixu-sync
fi
[[ $(id -u shixu-sync) -ne 0 ]] || { echo 'Service account must be unprivileged.' >&2; exit 1; }
install -d -m 0755 "$base" "$base/releases"
install -d -m 0700 -o shixu-sync -g shixu-sync /var/lib/shixu-sync
install -d -m 0750 -o root -g shixu-sync /etc/shixu-sync
if [[ ! -e /etc/shixu-sync/service.env ]]; then
  node --input-type=module -e '
    import { randomBytes } from "node:crypto";
    import { writeFileSync } from "node:fs";
    writeFileSync("/etc/shixu-sync/service.env", [
      "SYNC_HOST=127.0.0.1", "SYNC_PORT=8788",
      "SYNC_ORIGIN=http://127.0.0.1:8788", "SYNC_DATA_DIR=/var/lib/shixu-sync",
      "SYNC_PASSWORD=" + randomBytes(32).toString("base64url"), ""
    ].join("\n"), { mode: 0o640, flag: "wx" });'
  chown root:shixu-sync /etc/shixu-sync/service.env
  chmod 0640 /etc/shixu-sync/service.env
fi
runuser -u shixu-sync -- test -r /etc/shixu-sync/service.env || {
  echo 'Service account cannot read /etc/shixu-sync/service.env; inspect its ownership and permissions.' >&2
  exit 1
}
# Never make a raw copy of a live SQLite database: committed data may be in WAL.
if [[ -f /var/lib/shixu-sync/workspace.sqlite ]]; then
  node deploy/sync/backup.mjs /var/lib/shixu-sync/workspace.sqlite /var/backups/shixu-sync
fi
previous=
if [[ -L "$base/current" && -d "$base/current" ]]; then
  previous=$(readlink -f "$base/current")
fi
install -d -m 0755 "$target"
cp -R server deploy release.json SHA256SUMS "$target/"
chown -R root:root "$target"
chmod -R u=rwX,go=rX "$target"
install -m 0644 deploy/sync/shixu-sync.service "$unit"
ln -s "$target" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl daemon-reload
systemctl enable shixu-sync.service
systemctl reset-failed shixu-sync.service
systemctl restart shixu-sync.service || true
healthy=0
for attempt in {1..20}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8788/api/v2/status |
    node --input-type=module -e '
      let data = ""; for await (const part of process.stdin) data += part;
      const status = JSON.parse(data);
      if (status.application !== "shixu-sync" || status.protocolVersion !== 2) process.exit(1);' 2>/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ $healthy -ne 1 ]]; then
  systemctl stop shixu-sync.service
  if [[ -n "$previous" && -d "$previous" ]]; then
    # Code rollback only. Schema migrations require a separately reviewed restore.
    ln -s "$previous" "$base/current.rollback"
    mv -Tf "$base/current.rollback" "$base/current"
    install -m 0644 "$previous/deploy/sync/shixu-sync.service" "$unit"
    systemctl daemon-reload
    systemctl reset-failed shixu-sync.service
    systemctl start shixu-sync.service
  fi
  echo 'Health check failed. Inspect journalctl -u shixu-sync; no data was deleted.' >&2
  exit 1
fi
echo "Installed $release_id; API listening on 127.0.0.1:8788 only."
