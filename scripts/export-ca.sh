#!/bin/sh
# Export only the public CA certificate; leave its private key in the server volume.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p certs
docker compose cp leafnote:/data/caddy/pki/authorities/local/root.crt certs/leafnote-root.crt
echo 'Public certificate: certs/leafnote-root.crt'
echo 'Trust this certificate on each client device, then open the local HTTPS URL.'
