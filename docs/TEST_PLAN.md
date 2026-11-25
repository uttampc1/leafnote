# Leafnote v1.4.1 — step-by-step acceptance test plan

Run sections in order using disposable test content. The automated checks shipped with this release do not replace Linux deployment or physical-device testing. Direct editable `.txt` import is deferred; paste text into a Type box instead. Audio/transcription and AI study tools are outside this release.

## Record your setup

- Tester/date:
- Linux distribution/version and server IP:
- Docker / Compose versions:
- Source tag and `git rev-parse HEAD`:
- Device A / OS / browser/version / stylus:
- Device B / OS / browser/version / stylus:
- Device C (optional) / OS / browser/version / stylus:
- Stable HTTPS URL:

For every row, enter **PASS**, **FAIL**, **BLOCKED**, or **N/A** and an issue ID in Result. N/A requires a reason (for example, a mouse has no stylus pressure). If a result fails, record the actual behavior before continuing. Stop if notes disappear or saving fails; export a recovery backup and investigate before using real notes.

Prepare a small two-page PDF with selectable text such as `PDF-ALPHA`, plus one scanned/image PDF if available. Use `QA-` titles to keep test notes identifiable. Back up any existing client/server data first. Use one app window per browser profile.

## 1. Verify source, build, and start Linux

Follow BUNDLE_DEPLOYMENT.md for the full commands and replace example addresses with your actual IP.

| ID  | Step                                                                                          | Expected result                                                         | Result |
| --- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| S01 | Run the supplied SHA-256 check, clone the bundle, verify it, and switch to tag v1.4.1.        | Checksum OK; complete bundle; correct tag.                              |        |
| S02 | Configure `.env` and run `sh scripts/configure-sync.sh` with a dedicated empty server folder. | Chosen folder recorded; private connection code created.                |        |
| S03 | Run `docker compose config --quiet`, then `docker compose build --pull`.                      | Configuration validates; both v1.4.1 images build.                      |        |
| S04 | Run `docker compose up -d --no-build --wait` and `docker compose ps`.                         | Frontend and sync are healthy; only frontend HTTPS is published.        |        |
| S05 | Export the CA, trust it on each client, and open the exact HTTPS URL.                         | No certificate warning; app opens on every client.                      |        |
| S06 | Open Dashboard before pairing; try an incorrect sync code, then the correct code.             | Unpaired state is clear; wrong code fails; correct opt-in enables sync. |        |

## 2. Library and ordinary notes

Run on the primary device first; repeat basic create/edit/reopen on every other device.

| ID  | Step                                                                         | Expected result                                                                                                              | Result |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| N01 | Open Notes with fresh device preferences. Switch Grid → List → Grid.         | Default Grid shows large thumbnails; List shows notes left/editor right on wide screens. Small screens use a compact drawer. |        |
| N02 | Create `QA-Notebook`, then a new note named `QA-Paper`.                      | Note is named, assigned to a notebook, and starts on Lined paper with HB pencil.                                             |        |
| N03 | Draw a few marks, navigate to another note, and return; reload.              | Title, notebook, and ink persist without a Save action.                                                                      |        |
| N04 | Star/unstar the note and open Favorites.                                     | Membership and count update correctly.                                                                                       |        |
| N05 | Change sorting and filter by notebook. Open a thumbnail and return to Notes. | Results and previews match; current note remains editable.                                                                   |        |
| N06 | Open Library actions → Dashboard, then close it.                             | Single library Dashboard entry; dialog opens/closes without losing work.                                                     |        |

## 3. Typed text and writing tools

| ID  | Step                                                                          | Expected result                                                        | Result |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| W01 | Choose Type, click two different paper positions, and type unique phrases.    | Two editable text boxes appear at the chosen positions.                |        |
| W02 | Paste plain text; add Enter, spaces, and Tab indentation.                     | Text remains editable; spacing/line breaks appear as entered.          |        |
| W03 | Change one text box's color, size, and line spacing using Type popup; reopen. | Formatting applies to that box and persists.                           |        |
| W04 | Open Pencil/Pen popup. Try H, HB, 1B, 2B, then Pen colors and thicknesses.    | Pencil styles/pen widths differ; the pen icon reflects selected color. |        |
| W05 | Highlight, erase a mark, Undo, then Redo.                                     | Highlight is translucent; intended edits undo/redo on the active page. |        |
| W06 | Reopen the note after reload.                                                 | Typed text, styles, and ink all persist.                               |        |

## 4. Physical stylus and finger input

Run **every row on each intended device/browser**, recording a separate result per device. DEVICE_TESTING.md explains controls and the basic palm guard. Open the sliders/settings control beside the writing tools to find Draw with.

| ID  | Step                                                                                                | Expected result                                                                                    | Result by device |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| I01 | Select Stylus only · fingers scroll; draw slow/fast strokes, curves, dots, and separate letters.    | Pen draws without unintended joins or stuck strokes; mouse/finger do not draw.                     |                  |
| I02 | Choose Pen brush; vary pressure with Pressure ink on, then off.                                     | Reported stylus pressure changes width when enabled; unsupported hardware marked N/A.              |                  |
| I03 | Rest palm while writing; lift pen and resume elsewhere.                                             | No stray palm ink or unwanted jumps. Record any hardware-specific failure.                         |                  |
| I04 | Lift pen, wait briefly, and scroll with a finger in a scrolling mode.                               | Pages scroll without finger ink. Touch suppression near an active pen may briefly delay scrolling. |                  |
| I05 | Select Pen / mouse / finger; draw with one finger on the active page, then select a scrolling mode. | Finger draws in all-input mode and scrolls in scrolling mode.                                      |                  |
| I06 | Use toolbar eraser, Undo/Redo, then test hardware eraser if present.                                | Toolbar eraser works. Record hardware eraser support separately.                                   |                  |
| I07 | Rotate device/resize window and continue writing.                                                   | Marks align with pointer and remain attached to the correct content.                               |                  |

## 5. Multiple pages and paper styles

| ID  | Step                                                                      | Expected result                                                               | Result |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| P01 | In QA-Paper, create pages with visible labels A, B, C and distinct marks. | New pages default to Lined; Add labels show the correct page numbers.         |        |
| P02 | Give A Plain paper, B Grid, C Dotted. Navigate/scroll among them.         | Each page retains its own style; switching pages preserves content.           |        |
| P03 | Select C, then click Add page after page 1 under A. Label new page X.     | Order becomes A, X, B, C; X is selected and Lined.                            |        |
| P04 | Use Page actions to move C to position 1, then move it down/up.           | Content, handwriting language, and style travel together; numbering updates.  |        |
| P05 | Delete X, first canceling, then confirming.                               | Cancel leaves pages untouched; confirmation removes only X.                   |        |
| P06 | Edit an earlier page, Undo a mark, switch notes, then return and reload.  | Undo affects that page; order/content/style and remembered selection persist. |        |
| P07 | On a separate one-page test note, inspect Delete page.                    | Last-page deletion is disabled; whole-note removal is through Trash.          |        |

## 6. PDF import, markup, and export

| ID  | Step                                                                                                 | Expected result                                                                     | Result |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| D01 | Import the prepared selectable-text PDF through Library actions/More.                                | All original pages render; note appears with a thumbnail.                           |        |
| D02 | Add pen ink, highlight, and typed text on different pages. Resize/rotate and scroll.                 | Annotations stay aligned with the original pages.                                   |        |
| D03 | Add a page after the first; use a different paper style. Move an original page and an inserted page. | Original content and annotations travel together; paper guides overlay originals.   |        |
| D04 | Cancel then confirm deleting a disposable middle page.                                               | Correct page is removed only on confirmation.                                       |        |
| D05 | Export the annotated PDF and open it in another PDF viewer.                                          | Final page order, text, and annotations are visible.                                |        |
| D06 | Reload the app and reopen the imported PDF.                                                          | Original document, page changes, and markup persist.                                |        |
| D07 | Import a scanned PDF, if available; annotate it.                                                     | Image pages render and accept markup. A scan may lack searchable embedded PDF text. |        |

## 7. Brainstorm board

| ID  | Step                                                                | Expected result                                       | Result |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| B01 | Create QA-Board and add cards named `BOARD-ALPHA` and `BOARD-BETA`. | Card text is visible and editable by double-click.    |        |
| B02 | Connect the cards, choose Select, and drag each card.               | Cards move; connections follow.                       |        |
| B03 | Pan around the expansive canvas; add another idea and ink.          | Workspace remains usable beyond the initial view.     |        |
| B04 | Reopen/reload and view its library thumbnail.                       | Card text, positions, connections, and marks persist. |        |

## 8. Search and handwriting recognition

Recognition is probabilistic. Record the actual recognized text and errors; a failed word match may be an OCR accuracy issue even when indexing works. Do not count a manually corrected word as automatic recognition success.

| ID  | Step                                                                                                         | Expected result                                                                              | Result |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------ |
| F01 | Search a unique note title, typed phrase, and BOARD-ALPHA using All content.                                 | Matching notes/board appear under Search results; opening finds the content.                 |        |
| F02 | Search PDF-ALPHA and use PDF text filter.                                                                    | Selectable PDF text is found; filter excludes unrelated content.                             |        |
| F03 | Open Search tools → Language models; install English and Marathi while connected.                            | Download/progress completes; installed state is shown.                                       |        |
| F04 | Write `test`, `uttam`, and `उत्तम` by pen; assign appropriate recognition language and run Index all notes.  | Index completes or gives an actionable error; record actual output/accuracy for each word.   |        |
| F05 | Open Review handwriting; inspect output. Remove unwanted characters, save, then search the corrected phrase. | Corrections persist and become searchable; ink remains unchanged.                            |        |
| F06 | Repeat searches with Typed text & ideas, Handwriting, and PDF text filters.                                  | Each searches its content category; switching back to All content restores combined matches. |        |
| F07 | Remove an installed model, then reinstall it.                                                                | Model is removed/reinstalled without deleting notes, ink, or saved corrections.              |        |
| F08 | With models installed, disconnect and recognize a new disposable page.                                       | Installed recognition can run offline; report any model/runtime/browser error.               |        |

## 9. Backup and restore

Use a separate disposable browser profile for import tests. Import replaces that profile's notebook. Do not let this test overwrite a live synchronized workspace.

| ID  | Step                                                                         | Expected result                                                                          | Result |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| R01 | Export a full backup containing notes, multi-page PDF, and board.            | A nonempty backup file downloads.                                                        |        |
| R02 | In an unpaired disposable profile at the same server URL, import the backup. | Expected notes, PDF originals/markup, board connections, styles, and page order return.  |        |
| R03 | Edit an imported note, reload, and export it/PDF.                            | Restored content remains editable and exportable.                                        |        |
| R04 | Keep a server-folder backup using SYNC.md before further destructive tests.  | Backup includes history, snapshots, blobs, and configuration required by that procedure. |        |

## 10. Sync and Git revision history

Pair A and B to the same server/code using separate browser profiles. Wait for sync between steps; finish text editing/close popups when testing remote changes.

| ID  | Step                                                                                           | Expected result                                                         | Result |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| Y01 | On A create QA-Sync containing Version 1; wait and inspect B.                                  | Note and content arrive on B.                                           |        |
| Y02 | Change it to Version 2; wait, then inspect Dashboard → Revision history.                       | A new server revision is listed.                                        |        |
| Y03 | Restore Version 1 as a new note.                                                               | Separate recovered note appears; Version 2 remains intact.              |        |
| Y04 | Run `docker compose exec sync git -C /sync/history log --oneline -10`.                         | Autosave revisions exist in the server's separate notes Git repository. |        |
| Y05 | Edit/reorder ordinary pages, board cards, and PDF annotations on A. Inspect B after each sync. | Content, annotations, connections, and order match.                     |        |
| Y06 | Disconnect A, edit the same test note on A and B differently, then reconnect A.                | No silent loss; conflicting edits are retained as conflict copies.      |        |

## 11. PWA, offline persistence, and reconnect

| ID  | Step                                                                                     | Expected result                                                         | Result |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| O01 | Install app and wait for Offline notebook ready on each device.                          | App launches from its icon at the same origin.                          |        |
| O02 | Disconnect A from all networks; create/edit note text, ink, and a previously opened PDF. | Local autosave works; sync indicates offline/pending appropriately.     |        |
| O03 | Wait for Saved on device; close and reopen the installed app while offline.              | App shell and saved notes/PDF markup load.                              |        |
| O04 | Reconnect A and leave app open. Inspect B after sync.                                    | Pending changes reach server and B without manual re-entry.             |        |
| O05 | Repeat offline close/reopen on each target device.                                       | Results are recorded separately; browser-specific failures are visible. |        |

## 12. Dashboard, Trash, and permanent deletion

| ID  | Step                                                                                                  | Expected result                                                                                                 | Result |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| M01 | Open Library actions → Dashboard → Overview before/after importing a PDF.                             | Logical content total changes; browser estimate is labeled separately.                                          |        |
| M02 | Inspect location while paired and unpaired.                                                           | Paired server reports folder/usage; unpaired client shows unconfigured server.                                  |        |
| M03 | Trash a test note on A, inspect Trash on B, restore it.                                               | Note leaves active library, synchronizes to Trash, and restores with content intact.                            |        |
| M04 | Trash it again; cancel Delete permanently, then confirm.                                              | Cancel retains it; confirmation removes current note/PDF record. Older Git revisions/backups may retain copies. |        |
| M05 | Keep B offline before deleting a different test note permanently on A; reconnect B.                   | Stale offline state does not resurrect the permanently deleted note.                                            |        |
| M06 | Inspect Change server address guidance without migrating.                                             | Explicit export/import/pair workflow; no silent transfer.                                                       |        |
| M07 | Optional, disposable deployment only: follow Change Linux folder command, then restart/inspect notes. | Folder content/history preserved; Dashboard reports new location. Original folder retained for rollback.        |        |

## 13. Restart and update smoke test

| ID  | Step                                                                              | Expected result                                                                                                                     | Result |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U01 | Run `docker compose restart`; wait for healthy services and reopen clients.       | Server notes/history and certificate trust persist.                                                                                 |        |
| U02 | Rebuild/recreate the same source with `docker compose up -d --build --wait`.      | Data remains; frontend/API use matching image versions.                                                                             |        |
| U03 | If app reports a waiting update, choose More → Update app with a saved test edit. | Edit is saved before reload; app still opens notes. If no update is offered, mark N/A; this does not prove a cross-version upgrade. |        |
| U04 | Inspect `docker compose logs --tail=100 leafnote sync`; export a final backup.    | No unexplained repeated server errors; recoverable copy retained.                                                                   |        |

## Completion and issue record

Release acceptance: all applicable save/reload, PDF alignment, page-order, backup recovery, offline reopen, sync, and data-protection cases pass on the intended client matrix. Recognition accuracy and hardware-specific behavior are recorded separately; decide whether failures block your own use. Do not declare unrun tests passed.

| Issue | Test ID / device | Steps and actual behavior | Expected behavior | Severity / evidence | Retest |
| ----- | ---------------- | ------------------------- | ----------------- | ------------------- | ------ |
|       |                  |                           |                   |                     |        |

Final counts: PASS **_ / FAIL _** / BLOCKED **_ / N/A _**. Decision: ready for personal use / limited trial / needs fixes. Tester/date: \_\_\_.
