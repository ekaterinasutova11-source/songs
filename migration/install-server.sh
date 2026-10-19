#!/bin/bash
set -euo pipefail
umask 077
install -d -m 700 /root/songs-deploy
tar -xf /root/songs-deploy.tar -C /root/songs-deploy
getent passwd songs >/dev/null || useradd --system --home /var/lib/songs --shell /usr/sbin/nologin songs
cp -a /root/songs-deploy/app/. /opt/songs/
cp -a /root/songs-deploy/site/. /var/www/songs/
chmod -R a+rX /var/www/songs
install -m 600 /root/songs-deploy/app.env /etc/songs/app.env
install -m 600 /root/songs-deploy/backup-password /etc/songs/backup-password
install -m 644 /opt/songs/migration/songs.service /etc/systemd/system/
install -m 644 /opt/songs/migration/songs-backup.service /opt/songs/migration/songs-backup.timer /opt/songs/migration/songs-cert-renew.service /opt/songs/migration/songs-cert-renew.timer /opt/songs/migration/songs-monitor.service /opt/songs/migration/songs-monitor.timer /etc/systemd/system/
install -m 700 /opt/songs/migration/backup.sh /usr/local/sbin/songs-backup
install -m 700 /opt/songs/migration/monitor.sh /usr/local/sbin/songs-monitor
chown -R songs:songs /var/lib/songs
chmod 700 /var/lib/songs
install -m 644 /opt/songs/migration/nginx-http.conf /etc/nginx/sites-available/songs
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/songs /etc/nginx/sites-enabled/songs
nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl enable songs songs-backup.timer songs-cert-renew.timer songs-monitor.timer
systemctl start songs
/opt/certbot/bin/certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --preferred-profile shortlived --webroot --webroot-path /var/www/acme --ip-address 135.106.183.211 --cert-name songs-ip --deploy-hook '/usr/sbin/nginx -t && /bin/systemctl reload nginx'
install -m 644 /opt/songs/migration/nginx-https.conf /etc/nginx/sites-available/songs
nginx -t
systemctl reload nginx
systemctl start songs-backup.timer songs-cert-renew.timer songs-monitor.timer
systemctl is-active songs nginx
curl --fail --silent https://135.106.183.211/healthz
