### The board writes only what your note types declare

A review against the Obsidian Starter Kit found that the board wrote properties a note type does not have, and some values in the wrong shape. This release fixes that.

- **Each card uses its own type's dates.** On a board that mixes types, the calendar, the timeline, the WBS and the date prompts used the board's main type for every card. A Tasks board wrote `date_scheduled` on projects, and a Projects board wrote `date_started` on tasks. Now a project dropped on a calendar day gets its own start property. The agenda, the due badge and the `due:`, `defer:` and `scheduled:` filters follow the same rule.
- **No invented estimates.** A timeline drop no longer writes an estimate of 1 day. The card lands as a square; use **Set estimate…** to give it a span.
- **A note type can have no estimate.** Configure → Estimate has **No estimate**. Without a choice there, a Starter Kit type follows what it declares: `time_estimate` (minutes), `time_estimate_days` (days), or no estimate at all (activities, ideas, media).
- **Fractional day estimates stay fractional.** `0.5` stays half a work day in reads, roll-ups and writes. Only the bar on the chart rounds up to whole days.
- **New command: Check note types against the Starter Kit.** It lists, for each Starter Kit type, the properties the board uses that the type does not declare, or declares with another type. Only the features a type uses are checked (dates when its calendar is on, tracking when it has a Time tracking setting, time blocks when it is in the ideal week, its relationship links…), so a type is never blamed for a feature it does not use. It only reads.
- **Undeclared properties are left alone.** On a Starter Kit type, Add milestone, Set progress and Save total tracked time are hidden when the type does not declare the property, and the ideal-week rail skips types without time blocks. Drops, date prompts and new relationship links are skipped with a notice. Time tracking only warns: your session is still recorded.
- **Dates are written in the shape their property type asks for.** A date property gets `YYYY-MM-DD`, a date & time property `YYYY-MM-DDTHH:mm`, whatever the board's date format says.
- **Time tracking defaults to `time_spent` and `total_time_spent`.** The old default `duration` is the real length of music albums and exercises, so tracking added minutes to it. A stored `duration` or `total_duration` default moves on load; a name you chose stays.
- **New Starter Kit types get only the relationships they declare.** A movie no longer gets `parent`, `siblings` and `children` links.
- **One date reading everywhere.** A date and time with a time zone, such as `2026-09-08T23:30-05:00`, is the 8th in the calendar and in the lifecycle numbers alike.
- **`{{now}}`** stamps an ISO date and time (`2026-06-26T14:30`) in automation rules. Use it for date & time properties; `{{datetime}}` stays for names and folders.
