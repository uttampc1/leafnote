# Leafnote v1.4.1

Source release for local Linux Docker deployment and client-device testing.

Includes the Grid library and split List view; Dashboard under Library actions; storage/location reporting; recoverable Trash and confirmed permanent deletion; mixed-paper multi-page notes/PDFs; correct per-page insertion, move and delete controls; Lined defaults; pencil/pen and typed-text formatting; handwriting search/review with English and experimental Marathi models; brainstorm cards/connections; offline PWA and opt-in Git-backed server sync.

Start with docs/BUNDLE_DEPLOYMENT.md, then complete docs/TEST_PLAN.md and docs/DEVICE_TESTING.md on your intended devices. Runtime app/model assets are included. The first Docker build needs network access for base images and Git installation.

The source Git bundle includes development history. Your live notes use a separate Git repository created in the configured server folder. No personal notebook data, connection code, .env, CA certificates/private keys, installed npm dependencies, or built Docker images are supplied.

Validation: 235 app integration checks, 47 Node tests, function-documentation coverage, and Compose configuration checks pass. A fresh clone of the bundle is checked separately for repository integrity and model digests. Docker Engine and physical stylus/touch hardware are unavailable on the preparation machine; Linux container startup, LAN certificate trust, device PWA installation, and hardware behavior need your acceptance tests.

Direct text-file import is deferred; plain text can be pasted into editable Type boxes. Editable geometric shapes are a proposed follow-up and are not implemented in this release. Preserve backups before testing imports, permanent deletion, or server-folder migration.
