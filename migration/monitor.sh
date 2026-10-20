#!/bin/bash
set -euo pipefail
failed=0
curl --fail --silent --max-time 20 https://135.106.183.211/healthz >/dev/null || failed=1
openssl x509 -checkend 86400 -noout -in /etc/letsencrypt/live/songs-ip/fullchain.pem >/dev/null || failed=1
test -e /var/backups/songs-last-success || failed=1
if test -e /var/backups/songs-last-success; then
  age=$(( $(date +%s) - $(stat -c %Y /var/backups/songs-last-success) ))
  if (( age > 172800 )); then failed=1; fi
fi
percent=$(df --output=pcent / | tail -1 | tr -cd '0-9')
if systemctl is-enabled --quiet songs-cloud-backup.timer 2>/dev/null; then
  test -e /var/backups/songs-cloud-last-success || failed=1
  if test -e /var/backups/songs-cloud-last-success; then
    age=$(( $(date +%s) - $(stat -c %Y /var/backups/songs-cloud-last-success) ))
    if (( age > 172800 )); then failed=1; fi
  fi
fi
if (( percent >= 80 )); then failed=1; fi
if (( failed )); then echo 'Songs check failed: inspect HTTPS, certificate expiry, backup age and free disk space' >&2; exit 1; fi
echo 'Songs HTTPS, certificate, backup age and disk checks passed'
