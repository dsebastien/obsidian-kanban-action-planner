### Time from linked notes

A note can now get its tracked time from the notes that link to it, instead of one time entry per session. Keep each run, practice or board game play as its own note with its minutes and its date, link it to the activity, and the activity counts it.

- Turn it on per note type in **Configure → Time tracking → Time from linked notes** (off by default). The defaults read session notes tagged `type/session` (nested tags such as `type/session/sport/running` count too) that link to the note from `related_activities`, with their minutes in `time_spent` and their day in `date`. Each of the four names can be changed.
- The **weekly budget ring** adds the minutes of the session notes dated this week.
- **Recompute tracked time** (formerly **Recompute tracked time from entries**) stores the entries plus the session notes' minutes, and the later of the latest entry and the latest session as the last-session date. It now also shows on notes that have session notes but no entries.
- A time entry whose description links to one of these session notes is skipped, so a session logged both ways counts once.
- Scripts can read the same numbers with `app.plugins.plugins['kanban-action-planner'].api.computeTrackedTime(path)`.
