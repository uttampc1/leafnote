# Offline-first Linux server sync

Sync is optional. Notes always save to the client browser first. Once a device is paired, its durable local notebook and the server notebook merge when the app is open and can reach the server. If the app was closed while offline, reopening it resumes sync. Background execution while the app is closed is not promised.

## First Linux setup: choose the folder

From the extracted package:

```sh
sh scripts/deploy.sh 192.168.1.50
```

The first setup asks for a dedicated empty folder for server notes. Press Enter for `server-data` inside the application directory, or enter an absolute writable path such as `/srv/leafnote-notes`. The helper creates a private pairing code and records the folder/owner IDs in `.env`. It refuses nonempty folders and the public `dist` directory.

For unattended setup, supply the folder explicitly:

```sh
sh scripts/deploy.sh 192.168.1.50 /srv/leafnote-notes
```

Create that directory with the intended Linux account’s ownership first if the account cannot write under `/srv`. For example, an administrator can run `sudo install -d -m 700 -o "$(id -u)" -g "$(id -g)" /srv/leafnote-notes` before running setup as the normal Docker-enabled user. Use a simple absolute path without spaces or shell-special characters. The folder is chosen on the server, not through a browser filesystem picker.

## Upgrade an existing 1.0 deployment (no sync folder yet)

1. Export client notebook backups and back up the old application/configuration.
2. Replace the application source with this 1.2 package while preserving `.env` and the Caddy certificate volumes.
3. Choose the storage folder once:

   ```sh
   sh scripts/configure-sync.sh /srv/leafnote-notes
   docker compose up -d --build --wait
   ```

4. Close old Leafnote browser tabs and installed-app windows. Reopen one updated app window per browser profile. The new version coordinates a single writer per profile; an old 1.0 window cannot participate in that coordination.
5. Keep the same HTTPS host and port to retain existing client notes. If the service worker offers an update, finish edits and use **••• → Update app** or close all app windows and reopen online.

The storage directory must be owned by `LEAFNOTE_SYNC_UID:LEAFNOTE_SYNC_GID`, which the setup script derives from the account running it. Only the internal sync container mounts that folder. The Caddy container serves `dist` and proxies `/api/sync/*`; it does not publish the notes directory as static files.

## Upgrade a 1.1 sync deployment

Back up the entire existing server folder and export client backups. Preserve .env, the selected folder, and Caddy certificate volumes while replacing the source with 1.2. Run docker compose up -d --build --wait. Git is installed inside the sync image; the Linux host needs no Git installation for the service. On first startup the current server snapshot becomes the initial Git revision. Older pre-upgrade snapshot files are retained under their existing retention policy but are not presented as proven Git commits.

Close old browser/PWA windows, update the offline shell, and reopen the updated app. Sync protocol 2 rejects older clients so they cannot discard the deletion flag. Keep the same origin and pairing code. Do not run 1.1 against a folder already written by 1.2; restore a complete matching backup for a deliberate rollback.

## First client connection: choose whether to sync

Show the private connection code on the Linux server:

```sh
sh scripts/show-sync-code.sh
```

On first contact with a configured server, the app asks whether to save a copy on that server. Paste the code and choose **Enable sync**, or choose **Keep on this device**. No notebook content is sent before opt-in. You can reopen **••• → Server sync** later.

Each paired device receives the shared personal notebook and contributes its existing local notes. This is one personal workspace per server folder, protected by one shared connection code. It is not a multi-user account system. Use a separate deployment/folder for an unrelated person’s notebook.

The code travels in an Authorization header over HTTPS, never in a URL. It is remembered in the client’s `leafnote-sync` IndexedDB. Do not share the code with someone who should not read or modify the notebook. Pairing does not upload handwriting recognition models, preferences, or app-cache data.

## Everyday behavior

- Local edits save immediately on the device. Server availability is not required for writing.
- Sync starts shortly after editing finishes, on reconnect/foreground, and periodically while the app remains open.
- An active stroke, text editor, formatting popup, or handwriting review delays remote adoption. Sync does not cancel a stroke or replace a text box being edited.
- **Server sync** reports connecting, queued, offline, up-to-date, authentication errors, or completed sync. **Saved on device** remains a separate local-storage status.
- **Sync now** retries explicitly. **Disconnect this device** stops further requests and removes its stored code, keeping local notes, server notes, and the merge ancestor for a future reconnect. An already received server save may finish before cancellation reaches it.
- Current HTTPS browsers with Web Locks are required for sync. A second app window in the same browser profile is blocked before loading/saving notebook state; close the other window and reload. Different devices/profiles may sync simultaneously.

## Conflicts and deletions

Sync compares each note with the last successfully synchronized ancestor. It does not use device clocks to choose a winner.

| Changes since the ancestor                                | Result                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| One device edited a note                                  | Keep that edit                                                                 |
| Devices edited different notes                            | Keep both edits                                                                |
| Both changed the same note differently                    | Keep the server version and a clearly named conflict copy of the local version |
| One moved a note to Trash while another edited it offline | Retain the original in Trash and keep the edit as a recovered copy             |
| One moved an unchanged note to Trash                      | Synchronize its deleted flag; keep the content and PDF                         |

This is conservative whole-note conflict handling. Even a title/favorite change concurrent with another edit can produce a copy. The app does not merge individual handwritten strokes or text characters across devices. Reviewed handwriting corrections are user content; automatic OCR caches and modified timestamps do not by themselves create conflicts.

Conflict/recovered copies carry the correct original PDF. Content hashes let identical PDF originals be reused. Repeated retries use deterministic conflict IDs; editing an existing conflict copy does not allow a retry to overwrite it.

A successful push is recorded as a durable receipt before local adoption. If the user edited during the request or the app restarts, those edits rebase against the receipt. If a reply is lost before the receipt can be recorded, the next sync conservatively preserves the available versions; an extra recovery copy is possible. Unsaved local changes are never replaced merely because the server has a newer timestamp.

## What is on disk

```text
chosen-folder/
  auth.key                    private 64-character pairing code
  workspace.json              stable server-notebook identity
  CURRENT                     name of the committed metadata snapshot
  history/
    .git/                     private Git objects, commits, and refs
    notebook.json             latest committed notebook checkpoint
  snapshots/
    0000000000000001-UUID.json notebooks, notes, ink, text, boards, PDF hashes
  blobs/
    SHA256.pdf                immutable original PDF bytes
```

Each accepted autosave snapshot is committed to the private Git repository before it is published as current. Git HEAD is the revision authority; a valid HEAD repairs a lagging, missing, or damaged CURRENT pointer at startup. A Git failure prevents publication of the new save. Invalid Git history or a workspace mismatch fails startup rather than resetting the notebook. The last 50 auxiliary JSON snapshot files are retained; Git commits and PDF originals are not automatically purged. Monitor disk space and back up the whole folder.

Metadata is limited to 64 MiB per request; each PDF original is limited to 25 MiB. An oversized or failed sync reports an error and leaves the local notebook intact. The API supports one writer process per storage folder; do not scale two sync containers against the same directory.

## Back up and restore

Continue exporting client backups. Also back up the complete private server folder, including `history/.git`, `auth.key`, `workspace.json`, `CURRENT`, snapshots, and blobs. For a consistent server copy:

```sh
docker compose stop sync
tar -czf leafnote-server-backup.tar.gz -C /srv/leafnote-notes .
docker compose start sync
```

Store the backup outside the notes folder and protect it: server files and backups are readable JSON/PDF, not end-to-end encrypted. To restore, stop the sync service, restore the whole folder with its ownership/permissions, then restart it. Do not manually edit `CURRENT`, run multiple writers, or replace the folder while clients have pending sync receipts. Keep the original folder available until all clients are synchronized. Export local notebooks before deliberately pairing with a different workspace.

There is no automatic conversion into Markdown text files: handwriting, cards, PDF markup, and formatting need the complete notebook JSON. The server folder is a durable synchronized copy, while browser IndexedDB remains the offline working copy.

## Quick two-client test on Linux

1. Pair two different browser profiles or devices to the same server using its connection code. Create a throwaway note on one and wait for it to appear on the other.
2. Take the first client offline, edit the note, close/reopen the installed app, and verify the edit remains. Reconnect with the app open and check that the second client receives the edit.
3. Edit different notes on both clients while offline; reconnect and confirm both changes survive. Then edit the same note differently and confirm a conflict copy preserves both versions.
4. Import a small PDF, annotate it, and verify the original pages and annotations arrive on the second client. Repeat an annotation while offline.
5. Inspect the chosen server folder for `CURRENT`, snapshots, and PDF blobs. Restart the deployment and reopen the clients; confirm the notebook remains. Use throwaway notes when testing synchronized deletions.

## Autosave revisions and Maintenance

Open **••• → Maintenance**. **Trash** works offline: restore a note with the same ID, ink, typed text, board cards, metadata, and PDF original. Deleted records carry `deleted: true` and `deletedAt`; active lists, counts, and search exclude them. Exported full backups include them. No permanent purge button is provided.

**Revision history** uses your existing connection code to page through private Git commits. Select a commit and a note to preview its first page, then choose **Restore as new note**. The full note (all PDF pages, annotations, board content, and saved recognition text) is restored under a new ID. The current version remains unchanged. The preview shows ink and typed text; PDF backgrounds are available after restoration. Restoring creates a normal local change and a new server commit when sync succeeds.

Local autosave remains immediate in IndexedDB. The existing sync debounce groups editing activity (about 1.2 seconds after a saved edit) and sends a snapshot while idle/online. Each accepted snapshot becomes an actual Git commit named `Autosave revision N`, with a full commit ID and server timestamp. Offline intermediate keystrokes/strokes are not individual Git commits; reconnect commits the durable local state after the normal conflict merge. Git is server-side, and revision browsing requires server access.

The Git repository has no remote and uses a fixed local autosave identity. It tracks notebook JSON and immutable PDF hash references; the original PDFs remain in the sibling `blobs` folder. A Git-only clone is therefore not a complete PDF backup. Use the complete-folder backup procedure above. There is no history rewriting, garbage collection, or note purge action in the dashboard.

## Version 1.3

Version 1.3 adds the default thumbnail library and keeps the 1.2 sync protocol and server storage format. Preserve .env, server notes, Git history, and certificate volumes when upgrading. After rebuilding, update/reopen the client shell. Library Grid/List preferences stay on the device.
