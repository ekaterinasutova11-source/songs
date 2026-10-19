#!/bin/bash
set -euo pipefail
umask 077
exec 9>/run/lock/songs-backup.lock
flock -n 9 || exit 0
export RESTIC_REPOSITORY=/var/backups/songs-restic
export RESTIC_PASSWORD_FILE=/etc/songs/backup-password
install -d -m 700 /var/backups/songs-snapshot
sqlite3 /var/lib/songs/songs.sqlite '.backup /var/backups/songs-snapshot/songs.sqlite'
test "$(sqlite3 /var/backups/songs-snapshot/songs.sqlite 'PRAGMA integrity_check;')" = ok
restic snapshots >/dev/null 2>&1 || restic init
# Blobs are immutable and never garbage-collected while a snapshot is captured.
restic backup --tag songs /var/backups/songs-snapshot/songs.sqlite /var/lib/songs/blobs /etc/songs /etc/nginx/sites-available/songs /opt/songs /var/www/songs /etc/systemd/system/songs.service
restic forget --tag songs --keep-daily 7 --keep-weekly 4 --keep-monthly 2 --prune
restic check
date --utc +%FT%TZ > /var/backups/songs-last-success
