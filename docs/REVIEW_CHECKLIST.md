# Review checklist for the Dashboard and mixed-page build

This checklist accompanies the v1.4.1 source bundle. Automated checks pass; complete the Linux and physical-device checks after deployment. Older bundles remain unchanged.

## Changes to review in the current app

1. Open Notes and choose **List**. The list stays on the left and the selected note remains editable on the right. Select a different note and confirm the split remains. **Grid** uses the full window. Small screens use the compact list drawer.
2. Find **Library actions** in the top library header. Open it to import PDFs, create boards, export/import backups, or open Dashboard. Dashboard is kept inside Library actions to simplify the main view.
3. Open **Dashboard → Overview**. Check the logical size of notes/documents, retained Trash, and PDFs. The whole-app total is the browser's storage estimate, which also includes installed language models and offline app files. Some browsers do not provide that estimate; the measured content size remains available.
4. Review save locations. This device uses browser-managed storage; an operating-system browser data folder is not exposed. A paired Linux server reports its authenticated host folder and measured server-file usage. On the hosted app without a Linux backend, server storage is correctly shown as unconfigured.
5. **Change server address** guides an explicit export → open new origin → import → pair workflow. It does not silently move IndexedDB or send the connection code to another origin. **Change Linux folder** generates a command for the Linux administrator; it does not attempt to control Docker from the browser.
6. Create a throwaway ordinary note. Choose Lined for page 1. Add a page, choose Grid, and write on it. Return to page 1 and insert another page after it. Give that new page a different style. Check the ordering and the original pages' content.
7. Scroll through the earlier/later pages. Click a page heading to edit it, or begin a pen/mouse stroke on a neighboring ordinary page. Touch gestures scroll. Previous/Next and the page-number input also navigate. Undo should affect the current page's content, not another page.
8. Repeat with a throwaway PDF. Adding a page inserts a blank page after the current one and preserves annotations on existing pages. Paper guides overlay PDF content; Plain leaves the original PDF visible. Export and check that every original/inserted page and its annotations remain.
9. Export/import a full backup and reopen the app. Confirm page styles, page content, and PDF originals remain. **Import replaces the destination notebook**, so use a separate test profile or export a recovery copy first.
10. In **Dashboard → Trash**, test Restore and **Delete permanently** on throwaway notes. Cancel the permanent-delete confirmation once, then confirm it on another test. The note and its local PDF leave the current notebook/Trash. Content-free markers prevent stale offline clients from resurrecting that same note ID. Older Git revisions and exported backups can still retain copies; restoration from history uses a new ID.

## Linux folder changes

After deploying the matching backend, Dashboard can display the host path configured through `.env`. To change it, run the Dashboard-generated command from the Linux source directory:

```sh
sh scripts/change-sync-folder.sh /srv/leafnote-notes-new
```

Use a dedicated empty writable folder and the normal setup account. The helper stops sync, copies and compares all files (including Git history and PDF blobs), updates `.env`, and recreates the sync container with the new mount. The connection code and workspace identity remain the same. The original folder and a configuration backup are kept. If the switch fails, the helper restores the previous configuration and attempts to restart it. Do not delete the old folder until all clients have synchronized and you have a complete backup.

## Verification boundaries

The automated suite covers real app/IndexedDB flows, real PDF import/insertion/export, page-scoped undo, backup validation/reopening, two-client HTTP sync, stale-client permanent deletions, Git history retention, authenticated storage metadata, Dashboard controls, and safe address/command validation.

The folder migration helper is tested with real filesystem copies and comparisons while the Docker CLI is mocked: success, failed service switch/rollback, and nonempty destination refusal. This is not a Linux Docker launch test. Docker Engine and interactive browser automation are unavailable on the preparation machine. Visual layout, physical stylus behavior, and an actual Linux mount change still need hands-on validation.

This build uses sync protocol 3. Update both client and Linux backend together. The new protocol prevents older clients from dropping permanent-deletion markers or added-page state.

## Page-order follow-up

Create pages A, B, C; select C, then use the Add button under A. The new page should appear between A and B. Return to another note and back; the selected page and Add label should remain correct. Use Page actions to move C to position 1, move it down/up, and delete a middle page. Verify text, ink, style, and language move with each page. Try canceling deletion and deleting the last page (disabled). Repeat with a test PDF, export it, and reopen the app to confirm the final order. New blank pages default to Lined without changing existing page styles. These changes are included in the v1.4.1 source bundle.
