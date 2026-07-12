# Overleaf sync — setup walkthrough (renders docs/media/overleaf.gif)
#
# Render:  vhs docs/media/overleaf.tape   (or: npm run media)
# See docs/media/README.md. Needs an active project; the form is shown and then
# cancelled (Esc) so no real Overleaf token or clone is required to record.

Output docs/media/overleaf.gif

Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 640
Set Padding 16
Set TypingSpeed 55ms

Type "npm run dev"
Enter
Sleep 5s

# Overleaf needs an active project.
Type "/project new demo-paper"
Enter
Sleep 3s

# Open the Overleaf link form.
Type "/overleaf"
Enter
Sleep 2s

# Project link, then the Git token (masked). Enter advances between fields.
Type "https://www.overleaf.com/project/abc123def456"
Sleep 800ms
Enter
Sleep 500ms
Type "olp_exampletokenexampletoken"
Sleep 1s

# Cancel instead of submitting — recording doesn't clone a real project.
Escape
Sleep 1.5s

Type "/quit"
Enter
Sleep 1s
