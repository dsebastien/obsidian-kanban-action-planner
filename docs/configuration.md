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
