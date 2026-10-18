### Add card now links the parent your board is filtered on

Reported in the Knowii community. On a project note, a board embedded with
`filter=parent:"My project"` used to create tasks that were not linked to the project, so the new
card never showed up on that board. **+ Add card** now reads the `parent:` term of the board's
search, finds that note, and writes the link for you in the same step that sets the column's
status. The dialog tells you what it will do (`Linked to [[My project]] via related_projects.`).
When it cannot link (no note with that name, several matches, or no single fitting property), it
says why instead of guessing.

### A relationship role can use several properties

A task can have a project as a parent, or an activity, a plan, or a goal, each stored in a
different property. In **Configure board → Relationships**, each role (parents, siblings,
children, blocked by) now lists as many properties as you need, and each property can be limited to
the note types it links to.

- Everything you see merges them: a task linked to a project and a goal shows both parents, the
  `parent:` / `ancestor:` / `child:` search terms match both, and the WBS lists the task under each
  parent.
- When you add a link (card menu, **Set parent…**, dragging in the WBS, **Add card**), the plugin
  writes it to the property that fits the linked note's type. If none fits or several do, nothing
  is written and a notice explains why. Removing a link removes it from whichever property holds
  it.
- Existing setups keep working unchanged: one property per role, any note type.

### Relationships can come from the Obsidian Starter Kit

When your Starter Kit version declares a note type's relationships, they are mirrored into the
board (read-only, kept in sync) and used for reading and writing links. Edit them in the kit.
**Detect children by tag** stays yours. Without a declaration, you edit them in the plugin as
before.
