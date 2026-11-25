#!/bin/sh
# Configure an existing private IPv4 address and start the local HTTPS container.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
address=${1:-}
if ! printf '%s\n' "$address" | awk -F. '
  NF != 4 {exit 1}
  {for(i=1;i<=4;i++) if($i !~ /^[0-9]+$/ || $i+0>255) exit 1}
  !($1==192 && $2==168) && !($1==10) && !($1==172 && $2>=16 && $2<=31) {exit 1}
'; then
  echo "Usage: sh scripts/deploy.sh 192.168.1.50 (an IP already on this server)" >&2
  exit 2
fi
command -v docker >/dev/null || { echo 'Install Docker Engine and the Compose plugin first.' >&2; exit 1; }
docker compose version >/dev/null
if [ -f .env ]; then
  echo '.env already exists. Using that configuration; edit it to change the address.'
else
  umask 077
  printf 'LEAFNOTE_HOST=%s\nLEAFNOTE_BIND_IP=%s\nLEAFNOTE_HTTPS_PORT=8443\n' "$address" "$address" > .env
fi
docker compose up -d --build --wait
echo 'Leafnote is running. Export the public CA with: sh scripts/export-ca.sh'
echo 'The HTTPS URL is the LEAFNOTE_HOST and LEAFNOTE_HTTPS_PORT in .env.'
