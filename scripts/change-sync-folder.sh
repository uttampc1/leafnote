#!/bin/sh
# Copy a complete notebook to a new host folder; preserve the old folder and roll back config on failure.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
new=${1:-}
case "$new" in /*) ;; *) echo 'Usage: sh scripts/change-sync-folder.sh /absolute/new-folder' >&2; exit 2;; esac
case "$new" in *'"'*|*"'"*|*'$'*|*'`'*|*'#'*|*' '*|*'\'*|*'..'*) echo 'Use a simple absolute path without spaces or shell characters.' >&2; exit 2;; esac
old=$(sed -n 's/^LEAFNOTE_SYNC_DIR=//p' .env | tail -n 1)
[ -n "$old" ] && [ -f "$old/auth.key" ] || { echo 'Configure the existing notes folder first.' >&2; exit 2; }
old=$(CDPATH= cd -P -- "$old" && pwd)
umask 077
mkdir -p "$new"
new=$(CDPATH= cd -P -- "$new" && pwd)
case "$new" in "$PWD/dist"|"$PWD/dist/"*|"$old"|"$old/"*) echo 'Choose a separate private folder outside the current notes/public folder.' >&2; exit 2;; esac
case "$old" in "$new/"*) echo 'Do not use a parent of the existing notes folder.' >&2; exit 2;; esac
[ -z "$(find "$new" -mindepth 1 -maxdepth 1 -print -quit)" ] || { echo 'The destination must be empty.' >&2; exit 2; }
for command in docker cp diff awk mktemp; do command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }; done
docker compose version >/dev/null
backup=$(mktemp .env.before-storage-change.XXXXXX)
cp -p .env "$backup"
stopped=0
changed=0
# Restart the previous mount after errors; keep partial/new and original files for inspection.
recover() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$result" -ne 0 ] && [ "$stopped" -eq 1 ]; then
    if [ "$changed" -eq 1 ]; then cp -p "$backup" .env; fi
    echo 'Migration failed. Restoring the original service/configuration; both folders are kept.' >&2
    docker compose up -d --no-build --force-recreate --wait sync || echo 'Restart failed; check docker compose logs sync.' >&2
  fi
  exit "$result"
}
trap recover EXIT
trap 'exit 130' HUP INT TERM
stopped=1
docker compose stop sync
cp -a "$old/." "$new/"
diff -qr "$old" "$new" >/dev/null
chmod 700 "$new"
temporary=$(mktemp .env.storage-change.XXXXXX)
awk -v folder="$new" '/^LEAFNOTE_SYNC_DIR=/{print "LEAFNOTE_SYNC_DIR=" folder; next} {print}' .env > "$temporary"
chmod 600 "$temporary"
changed=1
mv -f "$temporary" .env
docker compose up -d --no-build --force-recreate --wait sync
stopped=0
echo "Notes folder updated: $new"
echo "Original folder preserved: $old"
echo "Previous configuration saved: $backup"
echo 'Refresh Dashboard after reconnecting. Workspace identity, connection code and Git history are preserved.'
