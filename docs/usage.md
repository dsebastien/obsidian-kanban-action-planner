---
title: Usage
nav_order: 2
---

# Usage

## Add a Kanban view to a Base

1. Open a **Base** (or create one).
2. Add a new view and choose **Kanban** from the view-type picker.
3. The Base's filters decide which notes appear; each note becomes a card.

You can add several Kanban views to the same Base — each is independent.

## Columns from status

Columns come from a **status property** on your notes. The plugin looks for a property named
`status` first, then any property whose name contains `status`. Each distinct value becomes a
column.

- Values can carry a numeric prefix to control column order: `10 Todo`, `20 Doing`,
  `30 Done` sort in that order, and the number is hidden on the column header.
- Notes with no status, or a value that isn't one of the columns, gather in an **Unmapped**
  column. It only shows when something is actually unmapped.

## Moving and reordering cards

- **Drag a card to another column** to change its status (the status property is rewritten).
- **Drag a card within a column** to reorder it; the new position is saved to a
  `manual_order` property on the note.
- **Drag a card to the Unmapped column** to clear its status.

Ordering is stored in your notes (not in plugin data), so it travels with the vault.

## Other interactions

- **Click** a card to open the note.
- **Right-click** (or long-press on touch) a card for a menu: open the note, set its status,
  or clear the status.

## Commands

No commands yet — the plugin works through the Bases view.
