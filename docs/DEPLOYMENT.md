# Local Linux deployment

For a source-first build using the Git bundle, start with [BUNDLE_DEPLOYMENT.md](BUNDLE_DEPLOYMENT.md).

## What runs where

Caddy serves the app over HTTPS and forwards the authenticated sync API to a private Node container. Setup asks for an empty server notebook folder. Clients keep IndexedDB as their offline working copy and ask permission before enabling sync. The server folder stores atomic JSON snapshots and immutable original PDF blobs. See [SYNC.md](SYNC.md) for pairing, conflicts, backups, and upgrading an existing 1.0 installation.

Caddy’s volumes still hold only its private certificate authority/configuration. The sync folder is a separate bind mount owned by the Linux setup account. One shared code protects one personal workspace; there are no separate user accounts.

## 1. Prepare Linux

Install [Docker Engine](https://docs.docker.com/engine/install/) and the [Compose plugin](https://docs.docker.com/compose/install/linux/). Commands assume your account can use Docker. Reserve the server’s address in DHCP or configure a static address using your Linux network settings.

Extract the package, enter its directory, and choose an address already assigned to the server:

```sh
sh scripts/deploy.sh 192.168.1.50
docker compose ps
```

The script writes `.env` only if it does not exist. To configure manually, copy `.env.example` to `.env` and edit:

```dotenv
LEAFNOTE_HOST=192.168.1.50
LEAFNOTE_BIND_IP=192.168.1.50
LEAFNOTE_HTTPS_PORT=8443
```

Then run `sh scripts/configure-sync.sh` to choose the server notebook folder and generate a connection code, followed by `docker compose up -d --build --wait`. If a firewall is enabled, allow TCP 8443 from your trusted LAN. On Ubuntu with UFW, for example:

```sh
sudo ufw allow from 192.168.1.0/24 to any port 8443 proto tcp
```

Change the subnet to match your network. The host port can change through `.env`; the container always listens on unprivileged HTTPS port 8443. Its HTTP health endpoint at 8080 is internal and is not published.

The first build needs internet access to pull the Node and Caddy base images and install Git in the sync image. All app/model assets are in this package; runtime model installation does not contact Hugging Face. For an air-gapped host, build on another machine of the same target architecture, use `docker save`, transfer the image, and `docker load` it before running Compose with `--no-build`.

## 2. Trust local HTTPS on each client

Installable PWAs require HTTPS except on the client’s own localhost. Bypassing a browser certificate error is not the intended deployment setup. Caddy issues a certificate for your local server IP with its private CA. [PWA requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [Caddy local HTTPS](https://caddyserver.com/docs/automatic-https).

Export **only the public root certificate**:

```sh
sh scripts/export-ca.sh
```

Transfer `certs/leafnote-root.crt` to each device over a trusted channel. Verify it came from your own server. Do not copy the CA private key out of the Docker volume.

- **Debian/Ubuntu client:** copy the certificate to `/usr/local/share/ca-certificates/leafnote.crt`, then run `sudo update-ca-certificates`.
- **Windows client:** import it into the current user’s Trusted Root Certification Authorities. PowerShell: `Import-Certificate -FilePath .\leafnote-root.crt -CertStoreLocation Cert:\CurrentUser\Root`.
- **macOS, iOS, Android:** install it using the device’s certificate/profile settings and enable trust as required. Browser certificate-store behavior differs; consult the device/browser instructions if the address still shows a certificate error.

Keep the `caddy_data` volume across upgrades. Recreating the CA requires trusting the new public certificate on every client. Configure `LEAFNOTE_HOST` to match the address clients actually use; using another name or IP causes a certificate mismatch.

To verify server TLS without changing a machine’s trust store:

```sh
curl --cacert certs/leafnote-root.crt https://192.168.1.50:8443/manifest.webmanifest
```

## 3. Install on a client

Open the trusted HTTPS address. On Chromium desktop browsers, use the install button in the address bar or **••• → Install app**. On iPhone/iPad Safari, use Share → Add to Home Screen. Available installation controls vary by browser; the app offers instructions when no native install prompt is exposed.

Keep the server connected until **•••** reports **Offline notebook ready**. Install English and/or Marathi under **Notes → Search tools → Language models** before using recognition away from the server. Optional model files are stored separately from the offline shell; removing a model frees its model store, not your notes.

Open the installed app, create a throwaway note, close it, disconnect the device from the LAN, and reopen it. Confirm writing, searching saved content, and an already-installed recognizer work. Reconnect and export a backup. This is the final device-level smoke check.

## Updates, rollback, and data

After changing source, run the checks, rebuild, and restart:

```sh
npm ci
npm run format
npm run docs
npm run prepare:app
npm test
docker compose up -d --build --wait
```

An installed app can continue running its old offline shell while a new version is downloaded. **••• → Update app** saves current edits before asking the waiting worker to activate and reloading. Closing all old app windows also lets a fully downloaded version activate naturally. Failed shell installation leaves the current version available.

Keep an old image tag if you want a rollback: `docker tag leafnote-local:1.4.1 leafnote-local:previous` before rebuilding. To roll back, retag the previous image as `leafnote-local:1.4.1`, then run `docker compose up -d --no-build`. A browser may still have a newer offline shell; close its windows, reconnect, and allow the older server version to install as another complete shell. Do not clear site storage to force an update without first exporting the notebook.

Export notebooks from every client. Synchronization propagates deletions; backups are still needed for recovery. Back up the complete server sync folder as well as client exports; Caddy/CA volumes alone do not contain the synchronized notebook. Clearing browser site data removes that client’s notes. A new IP, port, or HTTP/HTTPS scheme is a new origin and a different notebook store. **Import backup replaces destination notes.**

Stop with `docker compose down`. Avoid `docker compose down -v` unless you intend to remove the local CA and reconfigure client trust. The separate server sync folder persists across container replacement; protect and back it up as described in SYNC.md.

## Troubleshooting

- **Address not available:** `LEAFNOTE_BIND_IP` is not assigned to a server interface.
- **Certificate error:** trust the exported CA and check the configured hostname/IP.
- **Install unavailable:** confirm trusted HTTPS, browser installation support, and a valid manifest.
- **Notes appear missing:** check the exact browser profile and origin; use your exported backup for migration.
- **Recognition model not installed:** install it while connected to this server; model assets are deliberately excluded from the general shell cache.
- **Offline setup failed:** keep the server available and reload; check storage quota and the browser’s service-worker/cache diagnostics.

Logs: `docker compose logs --tail=100 leafnote`. Service health: `docker compose ps`.

## Server notebook storage and pairing

Version 1.2 asks for a server folder during setup and asks each client to enable sync. Run `sh scripts/show-sync-code.sh` on Linux and paste that private code into **••• → Server sync** on the client. See [SYNC.md](SYNC.md) for upgrades, backups, conflicts, one-writer-per-profile behavior, and the on-disk snapshot format. The sync container is private to the Docker network; only Caddy’s HTTPS port is published.

For an existing sync deployment, follow the 1.2 upgrade section in SYNC.md. Preserve the private history folder in backups. Use matching app and sync image versions; older clients are rejected by sync protocol 3 to protect recoverable deletions.
