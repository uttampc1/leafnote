# Verification record

Prepared on November 25, 2026. The execution machine is Windows with Node.js 22.16.0. Docker Engine, Podman, and an installed WSL distribution are unavailable here.

## Passed

- **177 existing application integration checks**, using the real maintained scripts, fake IndexedDB, native canvas adapters, real PDF.js/PDF-Lib import/export, and a fake OCR worker for scheduling/review tests. Includes note migration, Pencil grades, pressure samples, erasing, undo/redo, formatting, boards/connectors, PDF alignment, backups, search, and correction race guards.
- **10 PWA/package checks**: manifest/icons, cached offline navigation and query-versioned scripts, model/cache isolation, update-save gating, install-prompt/manual-install controls, pinned file sizes/digests for both recognition models, local English runtime aliases, and development-server MIME/traversal behavior.
- The generated function catalogue is checked against every first-party JavaScript function and callback. Source is formatted, with inline descriptions for named helpers and a complete generated function reference.
- Caddy **2.11.9** accepts the shipped configuration. Docker Compose **5.8.0** accepts `compose.yaml` with `.env.example` using `config --quiet`.
- POSIX shell syntax checks pass for both Linux scripts through Git Bash. The deployment helper rejects a public IP before invoking Docker.
- A temporary Caddy 2.11.9 process served the packaged files over HTTPS on loopback with a private CA. A Node HTTPS client used that CA with certificate-chain and hostname verification enabled. The notebook, worker, JS modules, WASM, and manifest endpoints were checked. No certificate was installed into this machine’s trust store. The temporary server was stopped after testing.

The initial HTTPS check found a missing `.webmanifest` MIME mapping on this host; the shipped Caddyfile now sets `application/manifest+json` explicitly.

## Not executed here

- **Docker image build and Linux container launch.** The image definition and Compose configuration are prepared and validated as described above, but no Docker runtime is available to build/run them here.
- **Actual LAN reachability on a Linux server’s 192.168.x.x interface.** The loopback HTTPS smoke check is not a LAN deployment.
- **Real browser installation, Home Screen launch, and airplane-mode device use.** The manifest, service worker, and install/update logic are tested programmatically; the final browser/device smoke check in DEPLOYMENT.md remains required.
- **Physical stylus hardware** and a new Marathi handwriting accuracy benchmark. Existing pen-input simulations and the app’s prior recognition implementation are retained; this packaging task does not retrain recognition models.

## Reproduce

```sh
npm ci
npm run check
docker compose --env-file .env.example config --quiet
sh scripts/deploy.sh 192.168.1.50
sh scripts/export-ca.sh
curl --cacert certs/leafnote-root.crt https://192.168.1.50:8443/manifest.webmanifest
```

Use an address assigned to your Linux server, trust its public CA on the client, and complete the installation/offline/reopen checklist in DEPLOYMENT.md. Preserve exported notebooks before migrating origins.
