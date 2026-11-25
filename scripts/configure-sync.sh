#!/bin/sh
# Choose a private server notebook folder once; never ask a browser for filesystem paths.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
folder=${1:-}
if [ -z "$folder" ]; then
  if [ ! -t 0 ]; then
    echo 'Pass an absolute storage folder: sh scripts/configure-sync.sh /srv/leafnote-notes' >&2
    exit 2
  fi
  printf 'Folder for server notes [%s/server-data]: ' "$PWD"
  IFS= read -r folder
  folder=${folder:-"$PWD/server-data"}
fi
case "$folder" in /*) ;; *) echo 'Use an absolute folder path.' >&2; exit 2;; esac
case "$folder" in *'"'*|*"'"*|*'$'*|*'`'*|*'#'*|*' '*|*'\'*|*'..'*) echo 'Use a simple absolute folder path without spaces or shell characters.' >&2; exit 2;; esac
if [ -f .env ] && grep -q '^LEAFNOTE_SYNC_DIR=' .env; then
  echo 'A sync folder is already configured in .env. Back it up before changing folders.' >&2
  exit 2
fi
umask 077
mkdir -p "$folder"
folder=$(CDPATH= cd -P -- "$folder" && pwd)
case "$folder" in "$PWD/dist"|"$PWD/dist/"*) echo 'Do not store private notes under the public dist folder.' >&2; exit 2;; esac
if [ -n "$(find "$folder" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo 'Choose an empty dedicated folder. Restore an existing notebook by configuring .env manually.' >&2
  exit 2
fi
if [ ! -f "$folder/auth.key" ]; then
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$folder/auth.key"
  printf '\n' >> "$folder/auth.key"
fi
chmod 700 "$folder"
chmod 600 "$folder/auth.key"
printf '\nLEAFNOTE_SYNC_DIR=%s\nLEAFNOTE_SYNC_UID=%s\nLEAFNOTE_SYNC_GID=%s\n' "$folder" "$(id -u)" "$(id -g)" >> .env
echo "Server notebook folder: $folder"
echo 'Connection code: run sh scripts/show-sync-code.sh on this server.'
