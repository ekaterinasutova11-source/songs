#!/bin/bash
# Run only after explicitly creating a new remote repository with restic init.
set -euo pipefail
umask 077
export RCLONE_CONFIG=/etc/songs/cloud-rclone.conf
export RESTIC_REPOSITORY=rclone:songscloud:Songs-private-backups/restic
export RESTIC_PASSWORD_FILE=/etc/songs/cloud-backup-password
test ! -s /etc/songs/cloud-repository-id
restic cat config | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])' > /etc/songs/cloud-repository-id.new
test -s /etc/songs/cloud-repository-id.new
mv /etc/songs/cloud-repository-id.new /etc/songs/cloud-repository-id
chmod 600 /etc/songs/cloud-repository-id
systemctl daemon-reload
systemctl start --no-block songs-cloud-backup.service
