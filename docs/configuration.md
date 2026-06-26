---
title: Configuration
nav_order: 3
---

# Configuration

## Property names

The plugin reads and writes ordinary note properties (frontmatter). The defaults below are
used today; per-view and per-profile overrides arrive in later releases.

| Property     | Default        | What it does                                                                                                                   |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Status       | `status`       | Its value places a card in a column. Auto-detected: a property named `status`, else any property whose name contains `status`. |
| Manual order | `manual_order` | Stores a card's position within its column (a number). Written when you drag to reorder.                                       |

The status property is auto-detected, but the **columns are defined explicitly** (see below),
not inferred from your notes' values.

## Defining columns

Columns are **defined**, never guessed from the values present in notes (so a typo can't
create a stray column). A board takes its columns, in order of preference, from:

1. the per-view **Statuses (columns)** list (view settings), then
2. the **Obsidian Starter Kit** note type's allowed status values (if installed), then
3. the global **Default statuses** list (plugin settings, one per line).

A leading number sets order and is hidden in the header — e.g. `10 Todo`, `20 Doing`,
`30 Done`. Notes whose status isn't a defined column go to the **Unmapped** column (shown
first by default; a view option can move it last; hidden when empty). With no definition at
all, every card sits in Unmapped.

## Manual order

When you reorder cards, the plugin assigns a numeric `manual_order`. It uses fractional
midpoints so a single move usually rewrites only the card you moved; a column is renumbered
to whole numbers only when needed (e.g. when some cards have no order yet).

## Profiles and the Obsidian Starter Kit

Board configuration (currently: colors) is grouped into a **profile**. When the Obsidian
Starter Kit plugin is installed and recognizes your notes as a note type, the board uses that
type as its profile — taking the status property and its allowed values from the Starter Kit
and building columns in the defined order, including empty ones. The Starter Kit remains the
source of truth for those facts; your color choices are stored locally in this plugin and
keep working even if the Starter Kit is disabled. When the Starter Kit is not present, a local
default profile is used and columns come from the status values found in your notes.

## Colors

Colors are saved per profile, so all boards of the same note type share them. Each status can
use an auto-assigned palette color, a chosen palette color, or a custom hex value. Column
backgrounds are a translucent blend of the card color over your theme background, so they look
right in both light and dark themes.

## Swimlanes

A board can be split into horizontal **lanes**. The grouping is saved per profile (and can be
overridden per view):

- **None** — one plain board.
- **By note type** — one lane per recognized Starter Kit note type.
- **By property** — one lane per distinct value of a chosen property; lanes order by a numeric
  prefix the same way columns do. Cards missing the value collect in an **Ungrouped** lane
  (hidden when empty).

Dragging a card to another lane rewrites the grouping property to the target lane's value (or
clears it for Ungrouped). Note-type lanes are read-only — a note's type comes from its
tags/folder — so cross-lane drags there are ignored.

## Relationships

Each relationship role reads a link-property (frontmatter wikilinks), configured per profile in
**Configure board → Relationships**:

| Role       | Default property | Meaning                          |
| ---------- | ---------------- | -------------------------------- |
| Parent     | `parent`         | Notes this note is a child of.   |
| Sibling    | `siblings`       | Peer notes (mutual).             |
| Child      | `children`       | Notes that are children of this. |
| Blocked by | `blocked_by`     | Notes blocking this one.         |

Inverse relations are derived automatically (a declared child gives the target a parent, and so
on). Setting a role's property to **None** disables link detection for that role. The **Detect
children by tag** option adds a heuristic: a note carrying one of the listed tags that links to
a card counts as that card's child.

Relationships are **read-only** — the plugin never writes them. A non-empty **blocked by** flags
the card (red badge + edge) and powers the **Blocked cards** view filter and badge navigation;
it never changes status on its own.

## Archiving

Archiving **moves** a note out of the board into a folder, saved per profile in **Configure
board → Archiving**:

- **Archive folder** — destination path. Supports placeholders resolved at archive time:

    | Placeholder    | Resolves to         | Example             |
    | -------------- | ------------------- | ------------------- |
    | `{{year}}`     | 4-digit year        | `2026`              |
    | `{{month}}`    | 2-digit month       | `06`                |
    | `{{day}}`      | 2-digit day         | `26`                |
    | `{{week}}`     | 2-digit ISO week    | `26`                |
    | `{{quarter}}`  | quarter (1–4)       | `2`                 |
    | `{{date}}`     | `YYYY-MM-DD`        | `2026-06-26`        |
    | `{{datetime}}` | `YYYY-MM-DD-HHmmss` | `2026-06-26-143015` |
    | `{{uuid}}`     | a fresh unique id   | `a1b2c3…`           |

    Placeholders are case-insensitive. Leaving the folder blank disables archiving. Missing
    folders are created; a name clash gets a numeric suffix so nothing is overwritten.

- **Auto-archive on status** — optional (off by default). When set, a card is archived the
  moment it **transitions into** that status; reordering within it does nothing.

Manual archiving is available from a card's right-click menu (**Archive**). Moves go through
Obsidian's file manager, so wikilinks to the note are updated and stay valid.
