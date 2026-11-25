# Leafnote — local notebook and installable PWA

This is the self-contained local deployment repository. It includes the app, both recognition models, Docker/Compose services, Linux deployment scripts, tests, and review documentation. It includes optional authenticated Linux-folder sync, Git autosave revisions, and recoverable Trash. Notes save first in each client browser’s IndexedDB, so writing and installed recognition models remain available offline.

## Run on a Linux LAN server

Install Docker Engine with the Compose plugin. Give the server a stable LAN address, then run from this directory:

```sh
sh scripts/deploy.sh 192.168.1.50
sh scripts/export-ca.sh
sh scripts/show-sync-code.sh
```

The first setup asks which empty folder should hold the server notebook. Each client asks before enabling sync and needs the private connection code. See [server sync](docs/SYNC.md) for first setup and upgrades.

Use your server’s **actual assigned address**, not the example. The script binds HTTPS on that address at port **8443**. It does not assign an address to your network interface.

Trust `certs/leafnote-root.crt` on each client, then open:

```text
https://192.168.1.50:8443/
```

Choose **••• → Install app**, or use the browser’s **Install app / Add to Home Screen** command. Wait for **Offline notebook ready** before disconnecting. Install recognition models while connected to the local server.

See [Linux deployment and certificate setup](docs/DEPLOYMENT.md) for firewall, certificates, installation, updates, and backups.

## Bring your existing notes

In the hosted app, choose **Notes → Library actions → Export backup**. At the new local HTTPS address, choose **Import backup**. Import replaces the notebook already stored at the destination.

The hosted address, a LAN IP, HTTP, HTTPS, and different ports are separate browser origins. They have separate note stores. Keep one stable local address and use backups when moving between them. Enabling Server sync pairs clients to the same personal notebook. Browser profiles remain separate offline stores; this is not a multi-user account system.

## Use it like a notebook

Open **••• → Maintenance** to restore deleted notes or browse server Git revisions. Server autosaves create commits; offline work stays local until it syncs. See [sync and recovery](docs/SYNC.md).

See [the simple user guide](USER_GUIDE.md), also available inside the app at **••• → Getting started**.

## Review the code

Start with [CODE_REVIEW.md](docs/CODE_REVIEW.md), then [the application flow](docs/ARCHITECTURE.md). Every first-party function and callback is indexed in [FUNCTIONS.md](docs/FUNCTIONS.md), with parameters, purpose, direct calls, mutations, return expressions, and source locations. Named helpers also have inline comments. Generated data is available in [functions.json](docs/functions.json).

Third-party code remains vendored and unmodified; its upstream notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development and checks

Node.js 22 or newer is required for development tools. The Linux host needs no Node installation: the private sync container supplies Node.js, and the frontend container supplies Caddy. Production code needs no npm runtime dependencies.

```sh
npm ci
npm run prepare:app
npm test
npm run check:docs
npm run serve
```

Open `http://127.0.0.1:8080` for development on that same machine. A plain `http://192.168.x.x` address does not provide the secure context needed for installation or service workers.

After editing code:

```sh
npm run format
npm run docs
npm run prepare:app
npm test
npm run check:docs
```

Build the container with `docker compose build`, or use the deployment script. The Docker build regenerates the offline asset index. See [VERIFICATION.md](docs/VERIFICATION.md) for what was tested and what still requires a Linux Docker host.

## Portable Git history

The working directory is already a local Git repository with the imported baseline, local deployment, and offline sync commits. A companion `leafnote-local-history-v1.2.0.git.bundle` can recreate that history elsewhere:

```sh
git clone leafnote-local-history-v1.2.0.git.bundle leafnote-review
```

The Linux source archive includes everything needed to build the app image, including model files, but excludes `.git`, installed npm dependencies, private certificates, server note data, connection codes, and machine-specific `.env` configuration.
