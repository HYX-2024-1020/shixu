#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $EUID -ne 0 || $# -ne 1 ]]; then
  echo 'Usage: sudo bash deploy/sync/install-accounts.sh /absolute/release/path' >&2
  exit 1
fi
release=$(realpath "$1")
cd "$release"
sha256sum --strict -c SHA256SUMS
node -e 'if (+process.versions.node.split(".")[0] !== 24) throw Error("Node.js 24 required")'
base=/opt/shixu-sync
unit=/etc/systemd/system/shixu-sync.service
env_file=/etc/shixu-sync/service.env
accounts=/var/lib/shixu-sync/accounts-v3
previous=$(readlink -f "$base/current")
[[ -d "$previous" && -f "$unit" && -f "$env_file" ]] || { echo 'Existing private service required' >&2; exit 1; }
if ! cmp -s "$unit" "$previous/deploy/sync/shixu-sync.service" &&
   ! cmp -s "$unit" "$previous/deploy/sync/shixu-accounts.service"; then
  echo 'Unknown service unit; inspect before replacing it' >&2; exit 1
fi
runuser -u shixu-sync -- node --env-file="$env_file" -e '
  if (!process.env.SYNC_ACCOUNT_SECRET || process.env.SYNC_ACCOUNT_SECRET.length < 32) throw Error("Account secret missing");
  if (process.env.SYNC_AI_ENABLED === "true") throw Error("Disable AI before deploying");
  if (process.env.SYNC_HOST && process.env.SYNC_HOST !== "127.0.0.1") throw Error("Loopback-only deployment required");'
release_id=$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync("release.json", "utf8")).releaseId)')
[[ $release_id =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
target="$base/releases/$release_id"
[[ ! -e "$target" ]] || { echo 'Refusing to overwrite a release' >&2; exit 1; }
install -d -m 0700 /var/backups/shixu-sync
snapshot=$(mktemp -d /var/backups/shixu-sync/accounts-upgrade-XXXXXXXX)
install -m 0600 "$env_file" "$snapshot/service.env"
install -m 0600 "$unit" "$snapshot/service.unit"
printf '%s\n' "$previous" > "$snapshot/previous-release"
if [[ -f /var/lib/shixu-sync/workspace.sqlite ]]; then
  node deploy/sync/backup.mjs /var/lib/shixu-sync/workspace.sqlite "$snapshot/legacy"
fi
rollback() {
  trap - ERR
  systemctl stop shixu-sync.service || true
  install -m 0644 "$snapshot/service.unit" "$unit"
  ln -s "$previous" "$base/current.rollback"
  mv -Tf "$base/current.rollback" "$base/current"
  systemctl daemon-reload
  systemctl reset-failed shixu-sync.service
  systemctl start shixu-sync.service || true
  echo "Upgrade failed; old code/unit restored. Snapshot: $snapshot" >&2
}
trap rollback ERR
systemctl stop shixu-sync.service
if systemctl is-active --quiet shixu-sync.service; then exit 1; fi
if [[ -d "$accounts" ]]; then
  node deploy/sync/backup-accounts.mjs "$accounts" "$snapshot/accounts" --service-stopped
fi
install -d -m 0700 -o shixu-sync -g shixu-sync "$accounts"
install -d -m 0755 "$target"
cp -R server deploy release.json SHA256SUMS "$target/"
chown -R root:root "$target"
chmod -R u=rwX,go=rX "$target"
install -m 0644 deploy/sync/shixu-accounts.service "$unit"
ln -s "$target" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl daemon-reload
systemctl enable shixu-sync.service
systemctl reset-failed shixu-sync.service
systemctl start shixu-sync.service
healthy=0
for attempt in {1..20}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8788/api/v3/status |
    node --input-type=module -e 'let text=""; for await (const chunk of process.stdin) text+=chunk; if (JSON.parse(text).protocolVersion!==3) process.exit(1);' 2>/dev/null; then
    healthy=1; break
  fi
  sleep 1
done
[[ $healthy -eq 1 ]]
[[ $(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8788/api/v2/changes) == 404 ]]
trap - ERR
echo "Installed account release $release_id; private loopback only. Snapshot: $snapshot"
