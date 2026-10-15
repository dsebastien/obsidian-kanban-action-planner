---
title: Tips & best practices
nav_order: 90
---

# Tips and best practices

## Order your columns with numeric prefixes

Prefix status values with a number to control column order, e.g. `10 Todo`, `20 Doing`,
`30 Done`. The number sets the order and is hidden in the column header. Without a prefix,
columns are ordered alphabetically.

## Match your notes' status values to your defined columns

Columns are **defined** (the per-view **Statuses (columns)** list, the Starter Kit, or the global
**Default statuses**) — they are never created from the values found in your notes. So a card only
lands in a column when its status value **matches** a defined one; anything else goes to **Unmapped**.
Keep your notes' status values consistent with the column definitions (mind `Doing` vs `doing` or a
trailing space — the plugin trims surrounding whitespace, but not other differences).

## Let the Base do the filtering

A Kanban view shows exactly the notes the Base selects. Use the Base's filters to scope a
board to one project, area, or note type, and add several Kanban views to the same Base for
different slices of the same notes.

## Common use cases

- A task board: `status` of `10 Todo` / `20 Doing` / `30 Done`, reordered by priority.
- A reading list: `status` of `To read` / `Reading` / `Read`.
- A content pipeline: `status` of `Idea` / `Draft` / `Review` / `Published`.

## Troubleshooting

### All my notes are in the "Unmapped" column

Either you haven't **defined any columns** yet, or your notes' status values don't match the ones
you defined. Define your statuses in **Configure view → Statuses (columns)** (or the global **Default
statuses**, or via the Starter Kit), then make sure each note's `status` matches one of them. The
Unmapped column disappears once every note maps to a defined column.

### My notes' `manual_order` changed without me moving them

When a board opens, the plugin gives a `manual_order` to every card that has none, and after a
drop it spreads out cards that share the same number. It does this in the background, a few
notes at a time, and every card keeps its place on the board. The first time a big board opens,
expect a short burst of saves (a minute or two with hundreds of unordered notes); after that,
moving a card normally updates only that card. Don't want it? Turn off **Tidy card order
automatically** in the plugin settings and use the **Normalize card order on this board** command
when you choose.

### Prefer a Text property for the status

A status stored as a **List** property works: the board uses its first value, and moves keep it a
list. A **Text** property is still simpler: one note, one status, nothing to keep in sync. If your
notes hold several status values in a list, only the first one decides the column.
