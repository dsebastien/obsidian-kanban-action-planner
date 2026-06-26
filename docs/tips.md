---
title: Tips & best practices
nav_order: 90
---

# Tips and best practices

## Order your columns with numeric prefixes

Prefix status values with a number to control column order, e.g. `10 Todo`, `20 Doing`,
`30 Done`. The number sets the order and is hidden in the column header. Without a prefix,
columns are ordered alphabetically.

## Keep status values consistent

A column is created for each distinct status value. Small differences (`Doing` vs `doing`,
or a trailing space) create separate columns, so keep values consistent across notes. The
plugin trims surrounding whitespace when reading a status.

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

The notes have no `status` property, or its values differ from what you expect. Add a
`status` property; each distinct value becomes its own column and the Unmapped column
disappears once every note is mapped.

### Reordering writes a number to several notes at once

The first time you reorder a column whose notes have no `manual_order` yet, the plugin
assigns whole-number orders to that column. After that, moving a single card normally updates
only that card.
