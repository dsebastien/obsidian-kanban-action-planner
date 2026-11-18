### Archived notes get their archive date

When an Obsidian Starter Kit note type names an archive date property (Starter Kit 1.54 or newer, in the type's **Archive** section), the planner now writes the day of the move into it whenever it archives a note. Before, a note the planner archived ended up in the archive without that date, so the note couldn't tell you when it went there.

It works the same for every way the planner archives:

- the sweep of aged done notes when a board loads
- the **Archive aged done notes (open boards)** command
- the **Archive** button of a done column
- **Archive** in a card's menu
- **Auto-archive on status**

The date goes in after the archive tag and before the move, like the Starter Kit's own archive rule does it.

- A note archived again gets the new date.
- A note that's already in its archive folder keeps the date it has.
- The date and the archive folder's year and month come from the same moment, so they never disagree around midnight.

Nothing changes for types that don't set an archive date property.

### Pomodoro records follow renamed notes

A pomodoro record (in the **pomodoros** list of your daily note, the format TaskNotes uses too) names its note by path, and Obsidian doesn't update plain paths when you rename a note. So after a rename, the records still pointed at the old name, and anything that finds a note's pomodoros by path lost those sessions.

Now, when you rename or move a note (archiving included), the planner updates the path in every pomodoro record that names it, in any note. That includes the records TaskNotes wrote.

A pomodoro running on the note follows the rename too: its record gets the new name, and it stays tied to the time session on that note. Before, renaming a note during a pomodoro left the pomodoro on the old path.
