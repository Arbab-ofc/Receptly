# Ubuntu / Debian VPS deployment

Use a supported Node 22 release (22.18+), npm 11, one backend process, persistent local disk, and a domain pointed at the VPS. Commands below assume `/srv/receptly`, service user `receptly`, and `receptly.example.com`. Replace the repository URL and hostname before running. No cloud deployment has been performed by the build agent.

## Install

```bash
sudo apt update
sudo apt install -y curl ca-certificates git nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
sudo useradd --system --create-home --home-dir /var/lib/receptly --shell /bin/bash receptly
sudo install -d -o receptly -g receptly /srv/receptly
sudo git clone YOUR_REPOSITORY_URL /srv/receptly
sudo chown -R receptly:receptly /srv/receptly
sudo -u receptly -H bash
cd /srv/receptly
cp .env.example .env
nano .env
chmod 600 .env
mkdir -p data/whatsapp-sessions data/logs
chmod 700 data data/whatsapp-sessions data/logs
npm ci
npm run build
npm test
npm run lint
exit
```

Set `NODE_ENV=production`, `PORT=3001`, `WEB_ORIGIN=https://receptly.example.com`, `WHATSAPP_SESSION_DIR=/srv/receptly/data/whatsapp-sessions`, and configure Firebase as described in `docs/firebase.md`. Set `VITE_API_BASE_URL=` for a same-origin deployment. Set the frontend Firebase values and `VITE_SITE_URL=https://receptly.example.com` before building. The public origin enables canonical links and absolute social-sharing image URLs. The frontend build generates route-specific HTML metadata for public pages; serve the entire `apps/web/dist` directory. Never place Admin credentials in frontend variables or `/public`.

## Process persistence: choose systemd or PM2

Systemd (recommended for a restricted service user):

```bash
sudo cp /srv/receptly/deploy/receptly.service /etc/systemd/system/receptly.service
sudo systemctl daemon-reload
sudo systemctl enable --now receptly
sudo systemctl status receptly
sudo journalctl -u receptly -f
sudo systemctl restart receptly
```

Alternatively, PM2:

```bash
sudo npm install -g pm2
sudo -u receptly -H pm2 start /srv/receptly/deploy/ecosystem.config.cjs
sudo -u receptly -H pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u receptly --hp /var/lib/receptly
sudo -u receptly -H pm2 logs receptly
sudo -u receptly -H pm2 restart receptly
```

Run one fork instance. Do not use PM2 cluster mode. Linked-device session ownership is process-local. Stop the existing process before switching between PM2 and systemd.

## Nginx and HTTPS

Obtain the certificate before enabling the provided HTTPS configuration:

```bash
sudo mkdir -p /var/www/html
sudo tee /etc/nginx/sites-available/receptly-bootstrap >/dev/null <<'NGINX'
server {
    listen 80;
    server_name receptly.example.com;
    root /var/www/html;
    location /.well-known/acme-challenge/ { try_files $uri =404; }
    location / { return 200 'Receptly setup'; }
}
NGINX
sudo ln -s /etc/nginx/sites-available/receptly-bootstrap /etc/nginx/sites-enabled/receptly-bootstrap
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/html -d receptly.example.com
sudo cp /srv/receptly/deploy/nginx.conf /etc/nginx/sites-available/receptly
sudo nano /etc/nginx/sites-available/receptly
sudo ln -s /etc/nginx/sites-available/receptly /etc/nginx/sites-enabled/receptly
sudo unlink /etc/nginx/sites-enabled/receptly-bootstrap
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Replace **every** `receptly.example.com` occurrence. Nginx serves the frontend, supports SPA route fallback, proxies `/api`, and disables buffering for SSE. Its CSP supports Firebase Authentication and same-origin API transport. If using a custom Firebase auth domain or separate API origin, add those origins to CSP and backend CORS. Static files must be readable by Nginx; service-owned secrets/data must not be. Configure separate read permissions for `apps/web/dist` if your system umask is restrictive.

```bash
sudo chmod -R a+rX /srv/receptly/apps/web/dist
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
curl -fsS https://receptly.example.com/api/health
```

Do not expose port 3001 publicly. Keep outbound HTTPS and WebSocket access available for Firebase and WhatsApp. Use your provider's firewall as well as UFW.

## Live acceptance

Register/sign in, configure the timezone and schedule, connect via QR, create a Pricing rule with `price,cost,charges` and response `Our pricing starts from ₹499.`, then enable the receptionist. Send a message from another phone. Verify one incoming message, one automatic reply, contact, lead, rule counter, activity log, and aggregate. Request a human; verify later messages do not auto reply. Test closed-hours cooldown. Restart the service and verify the existing session reconnects without QR. Close the browser while testing to verify the server owns automation.

## Updates and backups

Stop the backend before maintenance requiring session-file changes. Update code, `npm ci`, run build/tests/lint, then restart. Changing public Vite variables requires a frontend rebuild. Keep session directories outside ephemeral deploy artifacts. Back up `.env` and session storage encrypted with tightly limited access; export Firebase data separately. Session files grant linked-device access and must not be placed in public storage. Restore to a single server and relink if the session has been revoked from the phone. Test restore regularly.

Track log sizes and rotate PM2 logs (`pm2-logrotate`) or use journald retention. Preserve meaningful customer records; no default message deletion is applied. Review contact requests in the Firebase console. Before public commercial launch, personalize legal notices and support details, configure retention policy and monitoring, and complete the live acceptance checklist.

Backend recovery, monitoring, retention, account data, and encrypted backup commands are described in [backend-operations.md](backend-operations.md). Deploy the updated database indexes with these changes. Message/log retention remains disabled until configured; operator monitoring and alert delivery are optional server settings.
