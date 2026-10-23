---
title: Tips & best practices
nav_order: 90
---

# Tips and best practices

## Order your columns with numeric prefixes

Columns show up in the order you list them (in **Column values**, the Starter Kit, or **Default
column values**), and you can drag a column header to reorder a board. A number prefix such as
`10 Todo`, `20 Doing`, `30 Done` keeps that order visible in your notes too. The board hides the
number in the column header.

## Match your notes' status values to your defined columns

Columns are **defined** (the per-view **Column values** list, the Starter Kit, or the global
**Default column values**). The plugin never creates them from the values it finds in your notes.
A card only lands in a column when its status value **matches** a defined one; anything else goes
to **Unmapped**. So keep your notes' status values consistent with your columns. Watch out for
`Doing` vs `doing`, or a trailing space: the plugin trims surrounding whitespace, but it won't fix
any other difference.

## Let the Base do the filtering

A Kanban Action Planner view shows exactly the notes the Base selects. Use the Base's filters to
scope a board to one project, area, or note type. Want different slices of the same notes? Add
several of these views to the same Base.

## Common use cases

- A task board: `status` of `10 Todo` / `20 Doing` / `30 Done`, reordered by priority.
- A reading list: `status` of `To read` / `Reading` / `Read`.
- A content pipeline: `status` of `Idea` / `Draft` / `Review` / `Published`.

## Troubleshooting

### All my notes are in the "Unmapped" column

Either you haven't **defined any columns** yet, or your notes' status values don't match the ones
you defined. Define your statuses in **Configure view → Columns → Column values** (or the global
**Default column values**, or through the Starter Kit), then check that each note's `status` matches
one of them. The Unmapped column disappears once every note maps to a defined column.

### My notes' `manual_order` changed without me moving them

When a board opens, the plugin gives a `manual_order` to every card that has none. After a drop,
it spreads out cards that share the same number. This happens in the background, a few notes at a
time, and every card keeps its place on the board. The first time a big board opens, expect a
short burst of saves (a minute or two with hundreds of unordered notes). After that, moving a card
normally updates only that card. Don't want any of this? Turn off **Tidy card order
automatically** in the plugin settings, and run the **Normalize card order on this board** command
whenever you choose.

### Prefer a Text property for the status

A status stored as a **List** property works: the board uses its first value, and moves keep it a
list. A **Text** property is simpler, though: one note, one status, nothing to keep in sync. If your
notes hold several status values in a list, only the first one decides the column.
