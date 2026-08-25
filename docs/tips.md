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

### Reordering writes a number to several notes at once

The first time you reorder a column whose notes have no `manual_order` yet, the plugin
assigns whole-number orders to that column. After that, moving a single card normally updates
only that card.
