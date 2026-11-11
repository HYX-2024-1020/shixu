#!/bin/sh
# Run from a reviewed release at /srv/shixu-site/releases/site-<full commit>.
set -eu
test "$(id -u)" = 0 || { echo "Run as root" >&2; exit 1; }
release=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
case "$release" in
    /srv/shixu-site/releases/site-*) ;;
    *) echo "Unexpected release directory" >&2; exit 1 ;;
esac
revision=${release##*/site-}
printf '%s\n' "$revision" | grep -Eq '^[a-f0-9]{40}$' || exit 1
for item in public/index.html public/guide/index.html public/privacy/index.html public/404.html public/assets/site.css public/assets/icon.svg nginx.conf renew-hook.sh; do
    test -f "$release/$item" && test ! -L "$release/$item" || exit 1
done
test -s /etc/letsencrypt/live/shixunote.top/fullchain.pem
test -s /etc/letsencrypt/live/shixunote.top/privkey.pem
root=/srv/shixu-site
test ! -L "$root"
if test -e "$root/current" && test ! -L "$root/current"; then
    echo "Refusing to replace a real current directory" >&2; exit 1
fi
if test -e /etc/nginx/sites-available/shixu-site.conf; then
    grep -Fq '# Shixu public website:' /etc/nginx/sites-available/shixu-site.conf ||
        { echo "Unknown existing site configuration" >&2; exit 1; }
fi
if ! command -v nginx >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install --no-install-recommends -y nginx
fi
install -d -m 755 "$root/backups"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
if test -L "$root/current"; then
    readlink "$root/current" > "$root/backups/current-$stamp.txt"
fi
if test -f /etc/nginx/sites-available/shixu-site.conf; then
    cp -p /etc/nginx/sites-available/shixu-site.conf "$root/backups/nginx-$stamp.conf"
fi
stage="$root/current-$revision"
test ! -e "$stage" && test ! -L "$stage"
ln -s "$release/public" "$stage"
mv -Tf "$stage" "$root/current"
install -m 644 "$release/nginx.conf" /etc/nginx/sites-available/shixu-site.conf
ln -sfn /etc/nginx/sites-available/shixu-site.conf /etc/nginx/sites-enabled/shixu-site.conf
if test -L /etc/nginx/sites-enabled/default &&
   test "$(readlink -f /etc/nginx/sites-enabled/default)" = /etc/nginx/sites-available/default; then
    mv /etc/nginx/sites-enabled/default "$root/backups/default-$stamp.link"
fi
nginx -t
systemctl enable --now nginx
systemctl reload nginx
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
install -m 755 "$release/renew-hook.sh" /etc/letsencrypt/renewal-hooks/deploy/shixu-site
printf 'Public site release: %s\n' "$revision"
