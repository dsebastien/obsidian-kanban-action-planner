---
title: Overview
nav_order: 1
permalink: /
---

# Kanban Action Planner

Kanban Action Planner adds a **Kanban board view to [Obsidian Bases](https://help.obsidian.md/bases)**.
Plan and track any set of notes a Base selects, visually. Notes become cards, a status property
becomes the columns, and you drag cards between columns or reorder them. Every change is written
straight back into your notes.

![Kanban board]({{ '/images/board.png' | relative_url }})

## Key Features

- **Kanban view inside Bases.** Add a "Kanban Action Planner" view to any Base. The Base's filters
  pick the notes, and each note becomes a card.
- **Embed a board in any note.** `![[Tasks.base#Kanban]]` renders the view inside a markdown
  note, sized to its content up to a scrollable height cap. The alias overrides mode, height, and
  filter for that one embed (`|mode=wbs height=400 filter=status:active`) without touching the
  saved view. Add `columns=` and `lanes=` to narrow an embed to some columns or swimlanes. Embeds
  work in Canvas cards too.
- **Status to columns.** You define the columns explicitly (per view, from the Starter Kit, or in
  plugin settings). They're never guessed from your data, so a typo can't create a stray column.
  Each card is placed by its status property. Notes with no status, or an unknown one, collect in
  an **Unmapped** column that disappears when empty.
- **Drag, reorder, sort.** Drag a card to another column to change its status, or reorder it
  within a column (saved to the note). Moves show instantly and save in the background, usually
  rewriting only the card you moved; missing or duplicate orders get tidied up quietly. Auto-sort
  each column by name or any property, ascending or descending. Full keyboard support too.
- **Swimlanes.** Split the board into horizontal lanes by note type or any property, with
  collapsible lanes and columns. A board mixing note types groups by type automatically, and each
  lane gets its own type's columns: a card's status always follows its own type.

![Swimlanes]({{ '/images/swimlanes.png' | relative_url }})

- **Filter as you type.** A toolbar search box with a compact, Jira-like query language
  (`status:active OR due:overdue`, `parent:"PKM" -tag:archived`), saved per view. One-click
  date-window chips (**Today**, **Next 7 days**, **Next 30 days**) keep what's due or scheduled
  soon, and `review:due` finds the cards due for review. Don't feel like typing? The **Filter by
  property** button lets you tick a note type's property values instead.
- **Relationships.** See, navigate, and edit parent, sibling, child, and blocked-by links from
  the card menu. Blocked cards are flagged, and you can filter on them. A role can use several
  properties, each scoped to the note types it links to, and the Starter Kit can supply them.
- **Focus on a card's children or whole subtree.** Zoom into a project (from the card menu or the
  ▼ children badge) and the board re-filters to its children, or to all its descendants. From a
  task, zoom up via its ▲ parents badge to see all the project's children at once. A dismissible
  chip next to the filter box shows the focus, and zooming again drills down a level.
- **Triage mode.** Work through an overwhelming backlog one card at a time, setting priority,
  urgency, and effort with one-click controls. It doubles as a spaced-repetition review queue,
  and cards due for review show a **Review** badge on every board.

![Triage mode]({{ '/images/triage.png' | relative_url }})

- **Column triage.** Every column header has a triage button that starts a one-card pass over
  that column: swipe or drag the card, tap a status chip, or keep it and move on. ↑ steps back to
  undo the last decision. Every decision lands instantly, even on huge columns.

![Column triage]({{ '/images/column-triage.png' | relative_url }})

- **Calendar mode.** Switch a board to a calendar that shows scheduled dates and deadlines
  together. Drag a card onto a day to schedule it. Or right-click any card and type a date in
  words (`tomorrow`, `fri`, `next mon`, `in 3 days`), with a live preview of the day that will be
  written.
- **Timeline mode.** A Gantt-style view: one row per card, placed by its start date and an
  estimate (days by default; a note type can use its own property and unit, e.g. minutes).
  Milestone diamonds come from a configurable list property, and you drag to reschedule. The
  Unplanned panel groups cards by note type, then status.
- **WBS mode.** Break work down as a tree (goals over projects over tasks), with estimates,
  progress, and dates rolling up the hierarchy, drag re-parenting, and a "Needs planning"
  backlog. It works on filtered and flat views too: out-of-view ancestors show as context rows,
  and unlinked notes stay visible as standalone rows.
- **Drag between status groups.** In every scheduling panel (calendar, timeline, WBS), drop a
  card onto another status group to change its status in place.

![Calendar mode]({{ '/images/calendar.png' | relative_url }})

![Timeline mode]({{ '/images/timeline.png' | relative_url }})

![WBS mode]({{ '/images/wbs.png' | relative_url }})

- **Agenda mode.** A flat "what's next" list: Overdue, Today, and Upcoming. An availability
  switch hides deferred, blocked, and done cards until you want them.

![Agenda mode]({{ '/images/agenda.png' | relative_url }})

- **Ideal week mode.** Lay out how you want to spend a week: every active note's recurring time
  blocks on a date-less weekly grid. Drag, resize, and copy blocks, and the changes go straight
  into the notes. Overlaps are refused, and every note is listed against its weekly target.

![Ideal week mode]({{ '/images/week.png' | relative_url }})

- **Focus mode.** Spotlight a single card full-pane, with its properties, subtasks, and related
  notes. A start/stop timer feeds tracked time into the note, and the Done button goes through the
  standard write path, so your automations fire.

![Focus mode]({{ '/images/focus.png' | relative_url }})

- **Time tracking.** Start or stop a session from any card menu, from the active note, from a
  **Switch time tracking to…** picker, or with a per-note shortcut you bind a hotkey to. Each
  session is saved as a time entry, and its minutes add up in a duration property. **Pomodoro
  mode** runs timed work and break periods with a status-bar countdown and a visual timer. The WBS
  rolls tracked time up the tree, next to the estimates.

- **Archiving.** Move a finished note to a placeholder-driven archive folder, by hand or
  automatically when it reaches a chosen status (right away, or after a grace period counted from
  its done date). Folder notes (`Foo/Foo (Project).md`) take their whole folder along.
- **Done state.** Per note type, define what "done" means: a property plus the value(s) that
  count (e.g. the Completed and Done statuses, or a checkbox). Done notes count as 100% complete
  in WBS progress rollups, even without a progress number.
- **Automation rules.** Per note type: when a note enters or leaves a status, enters a done
  state, is archived, or a property crosses a condition (`progress ≥ 100`…), set or remove
  properties (with `{{date}}`-style placeholders), add or remove tags, or move the note to a
  placeholder-driven folder. A rule fires once per transition, from any write path, with no
  cascades.
- **WIP limits, multi-select and bulk actions, compact mode, overdue emphasis, hover preview.**
  Soft per-column limits, per-column aggregates (`Σ 13`), a Select mode (click, or Shift-click a
  range) with bulk set-status / archive / open, a titles-only compact toggle, red and amber
  due-date washes, a due countdown badge, and a native note popover on card hover.
- **GTD contexts.** Tag notes with `@work`, `@home` and so on, filter with the toolbar **@**
  switcher, and toggle contexts from the card menu.
- **Cards show your view's properties.** Each card shows the properties and formulas you picked
  in the Bases view. Optional extras: cover images, card colors from any property, and a title
  taken from any property.
- **Big boards stay fast.** Long columns only build the cards you can see, and covers load as
  you scroll.
- **Phones and tablets.** Long-press to drag a card. On a phone, the board shows one column at a
  time.
- **Colors and per-type card display.** Give each status a color (palette or custom, theme-aware),
  and choose which fields show on cards, per note type.
- **Quick capture.** Every column has a **+** in its header and an **Add card** button under its
  cards. Type a name, and the note is created in the right folder with the right template and
  lands in that exact column. It also gets whatever the Base filters on, so the card really does
  show up. Templates are applied through Templater, before the card's properties are written, so
  a template that prompts for a status can't override the column you clicked. The new card shows
  at once while the Base catches up. A board with no columns yet still offers **Add card**, and
  can save the status you pick as its first column. On a board filtered by `parent:"X"`, the new
  card is linked to X.

![Quick capture]({{ '/images/quick-capture.png' | relative_url }})

- **Obsidian Starter Kit aware.** The plugin works fully on its own. The
  [Obsidian Starter Kit](https://store.dsebastien.net/product/obsidian-starter-kit) is completely
  optional, but if you use it, the board configures itself. Columns, note types, colors per
  status, lanes on mixed boards, and the folder + template for new cards all come from your
  Starter Kit config, with nothing to set up. Your local choices are stored separately and keep
  working without it.
  [See how they fit together →]({{ '/usage.html#using-this-plugin-with-the-obsidian-starter-kit' | relative_url }})

![Note types]({{ '/images/note-types.png' | relative_url }})

- **What's new after updates.** After a plugin update, a one-time tab opens with the release
  notes you just received, including any versions you skipped. It never shows up on fresh
  installs or regular restarts.
- **Everything lives in your notes.** Status, order, dates, relationships, and grouping are all
  written to frontmatter, so your board is just your notes. No lock-in.

## Quick Start

1. Install and enable the plugin (Obsidian 1.13.0 or later): search for **Kanban Action
   Planner** in **Settings → Community plugins → Browse**.
2. Open or create a **Base**, then add a view and pick **Kanban Action Planner**.
3. Give your notes a `status` property. **Define your columns** by listing the status values in
   **Configure view → Columns → Column values** (one per entry, e.g. `10 Todo`, `20 Doing`,
   `30 Done`). You can also set vault-wide **Default column values** in the plugin settings, or
   let the Starter Kit provide them. Until you define columns, every card sits in **Unmapped**.
4. Drag cards between columns to change their status, and reorder or sort them within a column.
   Right-click a card for scheduling, archiving, relationships, and more.

## About

Created by [Sébastien Dubois](https://dsebastien.net).

<!-- other-plugins:start -->

## My other Obsidian plugins

| Plugin                                                                                                        | What it does                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Agentic Resource Discovery Server](https://github.com/dsebastien/obsidian-agentic-resource-discovery-server) | Local-first Agentic Resource Discovery publisher and registry that serves your AI skills and tools to agents over a local HTTP and MCP server |
| [Book Exporter](https://github.com/dsebastien/obsidian-book-exporter)                                         | Export books (one manifest note + linked chapter notes) to EPUB and PDF via Pandoc                                                            |
| [Bookshelf Base](https://github.com/dsebastien/obsidian-bookshelf)                                            | Display your notes as a visual bookshelf via a custom Bases view                                                                              |
| [Dataview Serializer](https://github.com/dsebastien/obsidian-dataview-serializer)                             | Serialize Dataview queries to Markdown, and keep the Markdown representation up to date                                                       |
| [Expander](https://github.com/dsebastien/obsidian-expander)                                                   | Replace variables across your vault using HTML comment markers. Supports static values and dynamic functions                                  |
| [Ghost Publish](https://github.com/dsebastien/obsidian-ghost-publish)                                         | Publish your vault notes to a Ghost blog with configurable presets for tags, newsletters, and frontmatter conventions                         |
| [Graph Explorer Base View](https://github.com/dsebastien/obsidian-graph-explorer-base-view)                   | A custom Bases view that renders notes as an interactive force-directed graph with explored/unexplored tracking                               |
| [Hidden Folders Access](https://github.com/dsebastien/obsidian-hidden-folders-access)                         | Index hidden root-level folders (e.g. .claude) so they appear in the file tree, metadata cache, and Bases                                     |
| [Journal Bases](https://github.com/dsebastien/obsidian-journal-base)                                          | Custom Base views for journaling and periodic reviews                                                                                         |
| [Life Tracker](https://github.com/dsebastien/obsidian-life-tracker-base-view)                                 | Capture and visualize the data that matters in your life                                                                                      |
| [Note Village](https://github.com/dsebastien/obsidian-note-village)                                           | A 2D pixel art village where your notes become villagers you can explore and chat with using AI                                               |
| [Obsidian Starter Kit](https://github.com/DeveloPassion/obsidian-starter-kit-plugin)                          | Adds strong typing support and powerful automation support for notes                                                                          |
| [Remarkable Synchronizer](https://github.com/dsebastien/obsidian-remarkable-sync)                             | Connect to the reMarkable cloud, list, download, and sync notebook pages as images                                                            |
| [Replicate](https://github.com/dsebastien/obsidian-replicate)                                                 | Use AI models with ease via the Replicate.com integration                                                                                     |
| [REST and MCP server](https://github.com/dsebastien/obsidian-cli-rest)                                        | Exposes CLI commands as RESTful API endpoints and an MCP server for AI tool integration                                                       |
| [Time Machine](https://github.com/dsebastien/obsidian-time-machine)                                           | Browse, compare, and restore previous versions of your notes using built-in file-recovery snapshots                                           |
| [Transcriber](https://github.com/dsebastien/obsidian-transcriber)                                             | Transcribe images to markdown using Ollama vision models                                                                                      |
| [Typefully](https://github.com/dsebastien/obsidian-typefully)                                                 | Publish social media posts with ease using the Typefully integration                                                                          |
| [Update Time](https://github.com/dsebastien/obsidian-update-time)                                             | Automatically update front matter to include creation and last update times                                                                   |

Everything I build is documented in [my newsletter](https://dsebastien.net/newsletter) and on [my YouTube channel](https://youtube.com/@dsebastien).

<!-- other-plugins:end -->

<!-- support-cta -->

## News & support

To stay up to date about this plugin, Obsidian in general, personal knowledge management and note-taking:

- Subscribe to [my newsletter](https://dsebastien.net/newsletter)
- Subscribe to [my YouTube channel](https://youtube.com/@dsebastien)
- Join the [Knowii community](https://www.store.dsebastien.net/product/knowii-community/) and learn to organize your notes and put your knowledge to work, together with fellow knowledge workers

If this plugin is useful to you, here are the best ways to support my work ❤️:

- [Join the Knowii community](https://www.store.dsebastien.net/product/knowii-community/)
- [Become a GitHub Sponsor](https://github.com/sponsors/dsebastien)
- [Buy me a coffee](https://www.buymeacoffee.com/dsebastien)
- [Subscribe to my YouTube channel](https://youtube.com/@dsebastien)
- [Check out my products](https://store.dsebastien.net)
