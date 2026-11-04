### A recompute never lowers your tracked time

Say you typed a total by hand on an activity, or deleted one of its session notes. The stored time is now higher than its entries and sessions. Until now, **Recompute tracked time** silently wrote the lower number. Now the planner never lowers a stored duration on its own. You decide.

- **Recompute tracked time** writes everything else at once, then opens one dialog listing each note whose stored time is higher, with the time from entries and sessions and the difference.
- **Keep** adds the difference as one entry named `Manual adjustment`. It starts at midnight on the note's `created` day (else the day of its first entry or session, else the file's creation day), or earlier so it never ends after now. The current week's rings don't jump (unless the note is from this week), and a second recompute changes nothing.
- **Drop** sets the duration to the entries and sessions total.
- After each choice, the row shows what was written and the other rows update. **Keep all** and **Drop all** answer every note at once. **Decide later** (or closing the dialog) changes nothing.
- Only the duration is protected: delete your latest session note and a recompute still moves the last-session date back. **Keep** never moves it earlier.
- **Save total tracked time** asks the same way when the stored total is higher than the subtree's.
- When a session note is deleted or shortened, the planner doesn't touch the activity: it flags it and shows one notice. A flagged note is checked again when it changes.
- **Recompute tracked time** is now also a palette command, for the note open in the editor (when it has entries or session notes) plus every flagged note. With nothing to decide, its notice says what changed, if anything.
- The WBS ⏱ total never shows less than the stored time.
- Scripts: `computeTrackedTime(path)` now also returns `storedMinutes` and `decision` (`{ stored, computed, difference }`, or `null`). When `decision` is set, ask before you write `minutes` (still the computed value).
