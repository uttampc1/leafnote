#!/bin/sh
# Show the private pairing code only to a local administrator who can read the folder.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
folder=$(sed -n 's/^LEAFNOTE_SYNC_DIR=//p' .env | tail -n 1)
[ -n "$folder" ] || { echo 'Configure server sync first.' >&2; exit 1; }
cat "$folder/auth.key"
