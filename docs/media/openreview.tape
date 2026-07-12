# OpenReview connector — setup walkthrough (renders docs/media/openreview.gif)
#
# Render:  vhs docs/media/openreview.tape   (or: npm run media)
# See docs/media/README.md for prerequisites and the dummy-credentials caveat.

Output docs/media/openreview.gif

Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 640
Set Padding 16
Set TypingSpeed 55ms

Type "npm run dev"
Enter
Sleep 5s

# Open the OpenReview link form.
Type "/openreview"
Enter
Sleep 2s

# Username (email or ~profile id).
Type "jane.doe@university.edu"
Sleep 800ms
Enter                      # advance to the password field
Sleep 500ms

# Password — renders as •••• on screen.
Type "not-a-real-password"
Sleep 800ms
Enter                      # submit → "OpenReview linked (…)"
Sleep 2.5s

# Start the guided review flow (lists submissions, fetches reviews).
Type "/openreview"
Enter
Sleep 3s

Type "/quit"
Enter
Sleep 1s
