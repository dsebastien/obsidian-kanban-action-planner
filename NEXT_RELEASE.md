### Tracked time is never lowered without you

A recompute no longer lowers a stored tracked time on its own. The stored duration can be higher than the time entries and session notes: a total you typed by hand, minutes another tool added, or a session note you removed or shortened. Before, **Recompute tracked time** replaced that total without a word. Now you decide.

- **Recompute tracked time** writes everything that lowers nothing, then opens one dialog with each note whose stored time is higher: the stored time, the time from entries and sessions, and the difference.
- **Keep** keeps the stored time. The difference becomes one time entry described `Manual adjustment`, dated at midnight on the note's `created` day (the file's creation day when there is none). It counts in the week the note was created, so this week's rings don't jump. A second recompute changes nothing.
- **Drop** sets the duration to the entries and sessions. **Keep all** and **Drop all** answer every note at once. Closing the dialog changes nothing.
- **Save total tracked time** asks the same way when the saved total is higher than the subtree's total.
- **Recompute tracked time** is now also a command: it covers the note open in the editor.
- When a session note is deleted or shortened, the planner never rewrites the activity. It shows one notice, "N notes hold more time than their entries and sessions: run Recompute tracked time to decide", and the command then covers those notes too.
- The WBS ⏱ total never shows less than the stored time.
- Scripts: `computeTrackedTime(path)` now also returns `storedMinutes` and `decision` (`{ stored, computed, difference }`, or null). `minutes` is still the computed value; when `decision` is set, don't write it without asking.
