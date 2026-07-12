# Zotero connector — setup walkthrough (renders docs/media/zotero.gif)
#
# Render:  vhs docs/media/zotero.tape   (or: npm run media)
# See docs/media/README.md for prerequisites and the dummy-credentials caveat.

Output docs/media/zotero.gif

Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 640
Set Padding 16
Set TypingSpeed 55ms

# Launch handoff from the repo (assumes a configured backend). Swap for `handoff`
# if you use the installed binary.
Type "npm run dev"
Enter
Sleep 5s

# Open the Zotero link form.
Type "/zotero"
Enter
Sleep 2s

# API key — renders as •••• on screen, so nothing real is exposed even on camera.
Type "P9NiFoyLeZu2bZNvvuQPDpx3"
Sleep 800ms
Enter                      # Enter advances to the user-id field
Sleep 500ms

# Numeric user id (from zotero.org/settings/keys).
Type "1234567"
Sleep 800ms
Enter                      # submit → "Zotero linked (user 1234567)"
Sleep 2.5s

# Kick off a prep on a paper in the library.
Type "/zotero-prep attention is all you need"
Sleep 2.5s

Type "/quit"
Enter
Sleep 1s
