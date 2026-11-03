### Time from linked notes

In my vault, every run, walk and music practice is already a note of its own, with its minutes and its date. Logging each session a second time as a time entry on the activity made those activity notes huge: my Walk activity had 725 entries, about 2,300 lines. Slow to open on mobile, and a steady source of sync conflicts. Now the session note carries the time, and the planner reads it from there.

- Turn it on per note type in **Configure → Time tracking → Time from linked notes** (off by default). It counts the notes tagged `type/session` (or a child tag such as `type/session/sport/running`) that link to the card from `related_activities`, with their minutes in `time_spent` and their day in `date`. You can change all four names.
- Those minutes count for the card on the session's date: in the **weekly budget ring** and in the over-budget notice.
- **Recompute tracked time** (formerly **Recompute tracked time from entries**) sets the duration to the entry minutes plus the linked minutes, and the last-session date to the later of the last entry and the last linked note. It writes nothing when nothing changes, and it leaves a hand-typed duration alone when there is nothing to count. It now also shows on notes that only have linked notes.
- A time entry whose description is a link to a linked note with minutes is skipped, so a session logged both ways counts once.
- Links must be wikilinks (`[[Run (Activity)]]`): a plain name is ignored. Dates are read as written (the first 10 characters, no time zone conversion).
- The WBS ⏱ tracked total and **Save total tracked time** use the activity's live total (entries plus linked minutes, no recompute needed) and count a linked note once, even when it also sits in the subtree.
- A project's or goal's weekly ring also adds the linked notes of its children, each once.
- Stopping the timer on a note with an empty duration stores the entries plus the linked minutes.
- Scripts can read the same numbers without writing anything: `app.plugins.plugins['kanban-action-planner'].api.computeTrackedTime(path)` returns `{ minutes, entryMinutes, linkedMinutes, lastSession, linkedNotes }`.
