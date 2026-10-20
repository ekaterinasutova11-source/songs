#!/bin/bash
# Read-only acceptance test: restores into a new private directory, never the live database.
set -euo pipefail
umask 077
export RCLONE_CONFIG=/etc/songs/cloud-rclone.conf
export RESTIC_REPOSITORY=rclone:songscloud:Songs-private-backups/restic
export RESTIC_PASSWORD_FILE=/etc/songs/cloud-backup-password
export RESTIC_CACHE_DIR=/var/cache/songs-restic-cloud
target=${1:-/var/tmp/songs-cloud-restore-2026-10-20}
case "$target" in /var/tmp/songs-cloud-restore-*) ;; *) echo 'Unexpected restore target' >&2; exit 1;; esac
test ! -e "$target"
install -d -m 700 "$target"
restic restore latest --target "$target"
node /opt/songs/migration/verify-data.mjs "$target/var/backups/songs-snapshot/songs.sqlite" "$target/var/lib/songs/blobs" > /root/songs-cloud-recovery-verification.json
test -s "$target/opt/songs/source.bundle"
test -s "$target/var/www/songs/assets/fonts/fonts.css"
test -s "$target/etc/nginx/sites-available/songs"
test -s "$target/etc/systemd/system/songs.service"
test -s "$target/usr/local/sbin/songs-backup"
test -s "$target/etc/songs/app.env"
echo 'Cloud recovery verified: database, material hashes, source bundle, frontend, fonts and operational configuration'
cat /root/songs-cloud-recovery-verification.json
