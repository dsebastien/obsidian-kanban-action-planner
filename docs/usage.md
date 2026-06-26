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

Cards are placed by a **status property** (the plugin looks for a property named `status`
first, then any property whose name contains `status`; you can override it per view).

The **columns themselves are defined explicitly** — they are not guessed from the values in
your notes (so a typo never creates a stray column). A board takes its columns, in order of
preference, from:

1. the **Statuses (columns)** list in the view settings, or
2. the note type's allowed status values from the **Obsidian Starter Kit** (if installed), or
3. the **Default statuses** list in the plugin settings.

If none are defined, every card sits in the **Unmapped** column — that's the starting point
until you define your statuses.

- Values can carry a numeric prefix to control order: `10 Todo`, `20 Doing`, `30 Done` show
  in that order, and the number is hidden on the column header.
- Notes whose status isn't one of the defined columns gather in **Unmapped** (shown first by
  default; hidden when empty).

## Moving and reordering cards

- **Drag a card to another column** to change its status (the status property is rewritten).
- **Drag a card within a column** to reorder it; the new position is saved to a
  `manual_order` property on the note.
- **Drag a card to the Unmapped column** to clear its status.

Ordering is stored in your notes (not in plugin data), so it travels with the vault.

## Other interactions

- **Click** a card to open the note; **Ctrl/Cmd-click** opens it in a new tab.
- **Right-click** (or long-press on touch) a card for a menu: open the note (or in a new
  tab), set its status, or clear the status.

## View options

Open the view's options (the Bases view settings) to tune a board without changing your
notes:

- **Status property** — choose which property drives the columns (overrides auto-detection).
- **Statuses (columns)** — the list of status values to show as columns, in order (one per
  entry). This is the per-view column definition.
- **Manual order property** — choose where card order is stored.
- **Show empty columns** — keep columns with no cards visible (useful when columns come from a
  note type's defined statuses).
- **Unmapped column position** — show the Unmapped column first (left, the default) or last
  (right). It still only appears when something is unmapped.

## Colors

Click the **gear** in the top-right of the board to open **Configure board**:

- Toggle **Auto-assign colors** to give each status a palette color automatically.
- Per status, pick a palette color, choose **Custom…** and use the color picker, or pick
  **Auto** to reset.

Card accents and column shades follow the status color and adapt to your light/dark theme.

## Card content

The Configure board dialog also controls what each card shows:

- **Title** — use the note name (default) or any property as the card heading. Clicking the
  card still opens the note.
- **Displayed fields** — add properties to show on the card, reorder them, and toggle a label
  for each. Values render by type (dates, numbers, lists, links).
- **Cover image** — pick a property holding an image link, vault path, or URL to show a cover
  at the top of the card.
- **Wrap long values** — wrap field values onto multiple lines instead of truncating them.

A note's **due date** is always shown in red when set, even without configuring fields.

## Obsidian Starter Kit integration

If the [Obsidian Starter Kit](https://store.dsebastien.net/) plugin is installed, the board
recognizes a note's type and uses that type's **status property and allowed values** to build
its columns — including empty columns in the type's defined order. The Starter Kit stays the
source of truth for that; your color choices are saved locally and survive the Starter Kit
being disabled. Without the Starter Kit, columns come from the status values found in your
notes.

## Where it lives

Everything happens inside the Bases Kanban view — there are no separate commands to run. The
plugin's settings tab holds the global default property names used when a note or board
doesn't override them.
