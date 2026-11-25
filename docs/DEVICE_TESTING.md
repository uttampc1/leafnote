# Test Leafnote on stylus and touch devices

Use test notes first. Run these checks on every intended device/browser; enter its model, OS/browser versions, pen model, and result beside each check. Pressure and palm handling depend on what the browser/device reports. This release has automated pointer tests, but physical stylus/touch hardware has not been tested on the preparation machine.

## Connect and install

1. Follow BUNDLE_DEPLOYMENT.md to start the Linux server, export its public CA certificate, and trust it on each client. Use the same stable HTTPS address on every device, for example `https://192.168.1.50:8443/` with your actual server IP.
2. Open **More (•••) → Server sync**, enter the server connection code, and enable sync. This shares one personal notebook between paired clients.
3. Install the PWA using your browser's install or Add to Home Screen control. Wait for **Offline notebook ready** before disconnecting. Install language models while connected if recognition is part of the test.
4. Export a backup before migrating existing notes. The hosted address and LAN address have separate storage. Importing a backup replaces the destination notebook.

## Choose how fingers behave

Open a note, choose the Pen tool, and open the sliders/settings icon beside the writing tools. Under **Draw with**, select:

| Setting                      | Expected behavior                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Pen / mouse · fingers scroll | Pen/mouse draws. A finger scrolls the paper.                                                                  |
| Pen / mouse / finger         | Pen, mouse, and finger can draw on the active page. Switch back to a scrolling mode to scroll over the paper. |
| Stylus only · fingers scroll | Only a pointer reported as a pen draws. Fingers scroll; mouse input does not draw.                            |

Touch near an active pen is suppressed briefly to reduce unintended marks. This is a basic palm guard; verify it with your own hardware. Finger drawings use regular width because touch pressure is not treated as stylus pressure.

## Stylus and finger checklist

- [ ] A new ordinary note starts on Lined paper. Choose Pen and try the default HB pencil, other pencil grades, pen colors and widths.
- [ ] In **Stylus only · fingers scroll**, write slowly, quickly, and diagonally; lift and resume. No unexpected lines should join separate strokes.
- [ ] With **Pressure ink** enabled and the Pen brush selected, vary pressure; width should vary if the device reports pressure. Disable Pressure ink and compare. Do not interpret fixed-width finger input as a pressure failure.
- [ ] Rest your palm while writing. Check for stray dots, unexpected scrolling, or stuck strokes. Try the eraser tool, Undo, and Redo. Pen hardware eraser support varies; report whether the toolbar eraser works separately.
- [ ] Lift the pen, pause briefly, then use a finger to scroll forward/backward. In **Pen / mouse / finger**, draw with one finger on the active page; switch to a scrolling mode and confirm the finger scrolls again.
- [ ] Add pages A, B, C. Insert after A, change one page to Grid, then use Page actions to move and delete a middle page. Confirm ink, text, style, and page numbers stay together. Try canceling deletion.
- [ ] Import a small PDF. Write and highlight on multiple pages; change the window orientation/size, scroll, and reopen. Marks should stay aligned with the original. Insert/reorder a page and export the PDF to check its final order and annotations.
- [ ] On a brainstorm board, create two idea cards, connect them, and move them in Select mode. Confirm text remains visible and the connection follows.

## Offline and multiple clients

1. On device A, finish a test note and wait for sync. Confirm it appears on device B.
2. Keep B online. Disconnect A from the network, edit a note, finish typing/drawing, and wait for **Saved on device**. Close and reopen the installed PWA offline; confirm the edit remains.
3. Reconnect A with the app open. Wait for sync and verify the change on B. Repeat with PDF ink and page reordering. Initially edit one device at a time.
4. Open **Notes → Library actions → Dashboard → Revision history**. Restore an earlier revision as a new note. Verify the newer note remains intact.
5. Move a test note to Trash, sync, and restore it. Use permanent deletion only with disposable test content. Prior Git revisions and exported backups may retain earlier copies.

## Report a problem

Record device/pen/OS/browser, installed PWA or browser tab, drawing-input mode, tool and pressure setting, online/offline state, exact steps, and expected versus actual behavior. Include whether the issue also happens with a mouse. Export the affected test note/backup if needed; do not clear browser storage to troubleshoot without first saving your notes.
