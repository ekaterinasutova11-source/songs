#!/bin/bash
# The remote repository must be explicitly provisioned and its id pinned first.
set -euo pipefail
umask 077
export RCLONE_CONFIG=/etc/songs/cloud-rclone.conf
export RESTIC_REPOSITORY=rclone:songscloud:Songs-private-backups/restic
export RESTIC_PASSWORD_FILE=/etc/songs/cloud-backup-password
test -s /etc/songs/cloud-repository-id
systemctl start songs-backup.service
# Prevent source snapshot retention/pruning while copying to the independent repo.
exec 9>/run/lock/songs-backup.lock
flock -w 600 9
actual=$(restic cat config | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
test "$actual" = "$(cat /etc/songs/cloud-repository-id)"
# Keep a fixed storage budget; never subscribe or upgrade an account automatically.
bytes=$(rclone size songscloud:Songs-private-backups/restic --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["bytes"])')
if (( bytes > 8589934592 )); then echo 'Cloud backup exceeded its 8 GiB budget; review retention' >&2; exit 1; fi
restic copy --from-repo /var/backups/songs-restic --from-password-file /etc/songs/backup-password --tag songs
restic check
# Retain snapshots; no cloud data packs are automatically purged here.
restic forget --tag songs --keep-daily 14 --keep-weekly 8 --keep-monthly 6
date --utc +%FT%TZ > /var/backups/songs-cloud-last-success
echo 'Independent encrypted cloud backup completed'
