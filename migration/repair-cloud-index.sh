#!/bin/bash
# Manual maintenance only, after a verified unreadable pack is moved to quarantine.
set -euo pipefail
umask 077
export RCLONE_CONFIG=/etc/songs/cloud-rclone.conf
export RESTIC_REPOSITORY=rclone:songscloud:Songs-private-backups/restic
export RESTIC_PASSWORD_FILE=/etc/songs/cloud-backup-password
export RESTIC_CACHE_DIR=/var/cache/songs-restic-cloud
systemctl start songs-backup.service
exec 9>/run/lock/songs-backup.lock
flock -w 600 9
restic repair index
restic copy --from-repo /var/backups/songs-restic --from-password-file /etc/songs/backup-password latest
restic check
