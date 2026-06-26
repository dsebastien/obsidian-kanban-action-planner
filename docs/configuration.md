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

Status auto-detection means you usually don't need to configure anything: add a `status`
property to your notes and columns appear.

## How values map to columns

- Each distinct status value becomes one column.
- A leading number sets column order and is hidden in the header — e.g. `10 Todo`,
  `20 Doing`, `30 Done`.
- Missing or unrecognized values go to the **Unmapped** column (hidden when empty).

## Manual order

When you reorder cards, the plugin assigns a numeric `manual_order`. It uses fractional
midpoints so a single move usually rewrites only the card you moved; a column is renumbered
to whole numbers only when needed (e.g. when some cards have no order yet).

## Coming soon

Configurable property names, note-type profiles (with Obsidian Starter Kit auto-detection),
colors, swimlanes, card customization, relationships, archiving, and calendar mode — see the
project plan and the GitHub issues.
