---
title: Overview
nav_order: 1
permalink: /
---

# Kanban Action Planner

Kanban Action Planner adds a **Kanban board view to [Obsidian Bases](https://help.obsidian.md/bases)**.
Any set of notes selected by a Base can be planned and tracked visually. Notes become cards,
a status property becomes the columns, and you drag cards between columns or reorder them, with
every change written straight back into your notes.

![Kanban board]({{ '/images/board.png' | relative_url }})

> In development. Features are delivered milestone by milestone, and this page reflects what
> currently works.

## Key Features

- **Kanban view inside Bases.** Add a "Kanban" view to any Base. The Base's filters choose the
  notes, and each note becomes a card.
- **Embed a board in any note.** `![[Tasks.base#Kanban]]` renders the view inside a markdown
  note, with a bounded height and internal scrolling. The alias overrides mode, height, and
  filter for that one embed (`|mode=wbs height=400 filter=status:active`) without touching the
  saved view.
- **Status to columns.** Columns are defined explicitly (per view, from the Starter Kit, or in
  plugin settings), never guessed from your data, so a typo can't create a stray column. Cards are
  placed by their status property, and notes with no or unknown status collect in an **Unmapped**
  column that disappears when empty.
- **Drag, reorder, sort.** Drag a card to another column to change its status, or reorder within a
  column (saved to the note). Auto-sort each column by name or any property, ascending or
  descending. Full keyboard support too.
- **Swimlanes.** Split the board into horizontal lanes by note type or any property, with
  collapsible lanes and columns. A board mixing note types auto-groups by type, each lane with
  its own type's columns — a card's own type is authoritative for its status.

![Swimlanes]({{ '/images/swimlanes.png' | relative_url }})

- **Filter as you type.** A toolbar search box with a compact, Jira-like query language
  (`status:active OR due:overdue`, `parent:"PKM" -tag:archived`), saved per view.
- **Relationships.** See, navigate, and edit parent, sibling, child, and blocked-by links from
  the card menu. A blocked card is flagged and filterable.
- **Focus on a card's children or whole subtree.** Zoom into a project (card menu or the
  ▼ children badge) and the board re-filters to just its children — or all its descendants — or
  zoom up from a task via its ▲ parents badge to see the whole project's children at once. A
  dismissible chip next to the filter box shows the focus; zooming again drills down a level.
- **Triage mode.** Work through an overwhelming backlog one card at a time, setting priority,
  urgency, and effort from one-click controls. It doubles as a spaced-repetition review queue.

![Triage mode]({{ '/images/triage.png' | relative_url }})

- **Calendar mode.** Switch a board to a calendar that plots scheduled dates and deadlines
  together. Drag a card onto a day to schedule it.
- **Timeline mode.** A Gantt-style view: one row per card placed by its start date and an
  estimate (days by default; a note type can use its own property and unit — e.g. minutes),
  milestone diamonds from a configurable list property, and drag-to-reschedule. The Unplanned
  panel groups cards by note type, then status.
- **WBS mode.** Break work down as a tree — goals over projects over tasks — with estimates,
  progress, and dates rolling up the hierarchy, drag re-parenting, and a "Needs planning"
  backlog. Works on filtered and flat views too: out-of-view ancestors show as context rows,
  and unlinked notes stay visible as standalone rows.
- **Drag between status groups.** In every scheduling panel (calendar, timeline, WBS), drop a
  card onto another status group to change its status in place.

![Calendar mode]({{ '/images/calendar.png' | relative_url }})

![Timeline mode]({{ '/images/timeline.png' | relative_url }})

![WBS mode]({{ '/images/wbs.png' | relative_url }})

- **Archiving.** Move a finished note to a placeholder-driven archive folder, manually or
  automatically when it reaches a chosen status.
- **Done state.** Per note type, define what "done" means — a property plus the value(s) that
  count (e.g. the Completed and Done statuses, or a checkbox). Done notes read as 100% complete
  in WBS progress rollups, even without a progress number.
- **Automation rules.** Per note type: when a note enters or leaves a status, enters a done
  state, is archived, or a property crosses a condition (`progress ≥ 100`…), set or remove
  properties (with `{{date}}`-style placeholders), add or remove tags, or move the note to a
  placeholder-driven folder. Fires once per transition, from any write path, with no cascades.
- **WIP limits, multi-select and bulk actions, compact mode, overdue emphasis, hover preview.**
  Soft per-column limits, Shift-click selection with bulk set-status / archive / open, a
  titles-only compact toggle, red and amber due-date washes, and a native note popover on card
  hover.
- **Colors and per-type card display.** Give each status a color (palette or custom, theme-aware),
  and choose which fields show on cards, per note type.
- **Obsidian Starter Kit aware.** The plugin works fully on its own. The
  [Obsidian Starter Kit](https://www.store.dsebastien.net/product/obsidian-starter-kit) is
  completely optional and simply pairs well with it. With it installed, columns and note types
  come from your Starter Kit config automatically, and your local choices are saved regardless.

![Note types]({{ '/images/note-types.png' | relative_url }})

- **Everything lives in your notes.** Status, order, dates, relationships, and grouping are all
  written to frontmatter, so your board is just your notes. No lock-in.

## Quick Start

1. Install and enable the plugin.
2. Open or create a **Base**, then add a view and pick **Kanban**.
3. Give your notes a `status` property. **Define your columns** by listing the status values in
   **Configure view → Statuses (columns)** (one per line, e.g. `10 Todo`, `20 Doing`, `30 Done`).
   You can also set vault-wide **Default statuses** in the plugin settings, or let the Starter Kit
   provide them. Until columns are defined, every card sits in **Unmapped**.
4. Drag cards between columns to change status, reorder or sort them within a column, and right-click
   a card for scheduling, archiving, relationships, and more.

## About

Created by [Sébastien Dubois](https://dsebastien.net).

<!-- support-cta -->

## News & support

To stay up to date about this plugin, Obsidian in general, Personal Knowledge Management and note-taking:

- Subscribe to [my newsletter](https://dsebastien.net/newsletter)
- Subscribe to [my YouTube channel](https://youtube.com/@dsebastien)
- Join the [Knowii community](https://www.store.dsebastien.net/product/knowii-community/) and learn to organize your notes and put your knowledge to work, together with fellow knowledge workers

If this plugin is useful to you, here are the best ways to support my work ❤️:

- [Join the Knowii community](https://www.store.dsebastien.net/product/knowii-community/)
- [Become a GitHub Sponsor](https://github.com/sponsors/dsebastien)
- [Buy me a coffee](https://www.buymeacoffee.com/dsebastien)
- [Subscribe to my YouTube channel](https://youtube.com/@dsebastien)
- [Check out my products](https://store.dsebastien.net)
