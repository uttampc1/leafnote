# Build and deploy Leafnote v1.2 from a Git bundle

The Git bundle is the source distribution. It includes the application, Dockerfiles, Compose configuration, recognition models, tests, documentation, and development commit history. It does not include personal notes, connection codes, certificates, `.env`, or built Docker images. The server creates a separate private Git repository for note revisions after deployment.

## 1. Prepare Linux and transfer the bundle

Install Git, Docker Engine, and the Docker Compose plugin for your Linux distribution. Your account must be able to use Docker. Verify:

```sh
git --version
docker info
docker compose version
ip -br -4 addr
```

Copy these two files to the same directory on the Linux server:

- `leafnote-v1.2.0-source.git.bundle`
- `leafnote-v1.2.0-source.git.bundle.sha256`

The first Docker build needs internet access to obtain the base images and install Git inside the sync image. Node.js/npm are not required on the host for a production build. All application and recognition-model assets are included in the bundle.

## 2. Verify and clone the release

Run from the directory containing the downloaded files:

```sh
sha256sum -c leafnote-v1.2.0-source.git.bundle.sha256
git clone leafnote-v1.2.0-source.git.bundle leafnote
cd leafnote
git bundle verify ../leafnote-v1.2.0-source.git.bundle
git switch -c deploy-v1.2.0 v1.2.0
```

The checksum should report OK; bundle verification should confirm a complete history. The release tag pins the source used for the build. `origin` points to the local bundle file, not GitHub or an online update service.

## 3. Configure the server and its notes folder

For a new installation:

```sh
cp .env.example .env
```

Edit `.env` with your preferred editor. Replace the example IP with an address already assigned to this server:

```dotenv
LEAFNOTE_HOST=192.168.1.50
LEAFNOTE_BIND_IP=192.168.1.50
LEAFNOTE_HTTPS_PORT=8443
```

Use a stable LAN IP. These settings do not configure the network interface. Allow TCP 8443 from the intended LAN clients if your firewall blocks it.

Choose the server notes folder once:

```sh
sh scripts/configure-sync.sh
```

Press Enter for the default `server-data` directory or enter an absolute writable path to a dedicated empty directory. Use a path without spaces. The script records its location/owner IDs in `.env` and creates the private connection code. Keep notes outside `dist`.

For noninteractive setup, pass the folder explicitly, for example:

```sh
sh scripts/configure-sync.sh "$HOME/leafnote-notes"
```

Use either the interactive or noninteractive command, not both. Existing deployments should preserve their `.env`, notes directory, and Caddy certificate volumes; see [SYNC.md](SYNC.md) for upgrading instead of rerunning first-time configuration.

## 4. Build the images locally

Run from the cloned repository:

```sh
docker compose config --quiet
docker compose build --pull
docker image ls leafnote-local:1.2.0
docker image ls leafnote-sync:1.2.0
```

The build produces `leafnote-local:1.2.0` (HTTPS frontend) and `leafnote-sync:1.2.0` (Git-backed sync API). Both images are built on your machine from the cloned source. No prebuilt Leafnote image is downloaded. The frontend build regenerates the offline asset index; no separate npm build is needed.

## 5. Deploy the images you built

```sh
docker compose up -d --no-build --wait
docker compose ps
```

Both services should be running and healthy. Only the frontend HTTPS port is published; the API is reached through that frontend.

Export the public certificate and display the private pairing code:

```sh
sh scripts/export-ca.sh
sh scripts/show-sync-code.sh
```

Trust `certs/leafnote-root.crt` on each client, as described in [DEPLOYMENT.md](DEPLOYMENT.md). For a Windows client, copy that public file to the client and run PowerShell from its folder:

```powershell
Import-Certificate -FilePath .\leafnote-root.crt -CertStoreLocation Cert:\CurrentUser\Root
```

Open `https://192.168.1.50:8443/` using your configured IP/port. Choose **More (•••) → Server sync**, supply the connection code, and enable sync. The code is private; do not share it with someone who should not access the notebook.

The hosted app and LAN address have separate client storage. Export a backup from the hosted app if migrating notes. Import it into the new empty client before enabling sync; import replaces the destination notebook.

## 6. Check revision history and offline sync

Use throwaway notes initially:

1. Pair two devices or different browser profiles with the same URL/code. Use one editor window per profile.
2. Create a note containing `Version 1`. Press Escape to finish typing, close editing popups, and wait for a successful sync.
3. Change it to `Version 2`, finish editing, and wait for another sync.
4. Open **More → Maintenance → Revision history**, select an earlier commit and the note, then **Restore as new note**. Confirm Version 1 returns as a separate note and Version 2 remains intact.
5. Install the PWA and wait for **Offline notebook ready**. Disconnect a client, edit a note, finish editing, and wait for **Saved on device**. Close/reopen it offline and verify the edit remains. Reconnect with the app open; confirm the other client receives it.
6. Move a synchronized note to Trash, verify Trash on the other client, then restore it. Repeat a sync test with a small PDF and annotations.

Inspect the real server Git commits:

```sh
docker compose exec sync git -C /sync/history log --oneline -10
```

Expect `Autosave revision N` commits. Local autosave is immediate; Git commits occur when snapshots reach the server, not for every intermediate offline keystroke. See [SYNC.md](SYNC.md) for conflict tests and full-folder backups. Git history references PDF hashes; the complete notes directory, including `blobs`, is required for a full backup.

## Optional: create portable packages locally

To recreate a source archive from the release tag:

```sh
git archive --format=tar.gz --prefix=leafnote-local/ --output=../leafnote-v1.2.0-source.tar.gz v1.2.0
```

To export both locally built Docker images for another machine of the same target architecture:

```sh
docker image save -o ../leafnote-v1.2.0-images.tar leafnote-local:1.2.0 leafnote-sync:1.2.0
```

On the destination, clone the source bundle for Compose/scripts, run `docker image load -i /path/to/leafnote-v1.2.0-images.tar`, configure its `.env` and notes folder, then run `docker compose up -d --no-build --wait`. Image files do not contain your live notes, server configuration, or certificate volumes.

## Troubleshooting and verification scope

```sh
docker compose ps
docker compose logs --tail=100 leafnote sync
```

Do not clear browser storage to troubleshoot an update without first exporting notes. Preserve the complete notes directory and Caddy volumes across rebuilds. Avoid `docker compose down -v` during routine maintenance.

The bundle is verified by cloning it, checking release content/model digests, running automated application/recovery tests, and validating Compose configuration. A Docker engine is unavailable on the preparation machine; the image build, Linux container launch, and device offline tests must be confirmed on your Linux server.
