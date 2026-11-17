### Retention: done notes can delete themselves

One-off notes ("Pay the electricity bill", "Book the car service") have no value once they're done. You can now give a note a retention period, and the planner deletes it that many days after it was completed (#241).

- Add `retention_days` to a note: `7` deletes it 7 days after its completion date, `0` keeps it forever.
- Or set a default per note type under **Configure board → Archiving → Retention**, for the notes that set no number of their own.
- It's **off by default**. Turn it on under **Settings → Retention**.
- Before anything is deleted, you get a list of the notes that are due, each with a checkbox. You can switch that question off once you trust it.
- A note that another note links to is kept (you can change that). A reopened note is never deleted.
- The whole vault is checked when Obsidian starts and every hour, so archived notes are covered too. There's also a command: **Delete done notes past their retention period**.
- A note you edited during its period waits for a full period after the edit, so a task you completed a second time isn't deleted on its old date.
- Deleted notes go where Obsidian's **Deleted files** setting sends them. With the system trash or the vault's `.trash` folder, you can get a note back.
