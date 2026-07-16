# Kanban Action Planner

An Obsidian plugin that adds a **Kanban board view to [Obsidian Bases](https://help.obsidian.md/bases)**, so any set of notes can be planned, tracked, and scheduled visually.

A status property you define becomes the columns. You drag cards between them, reorder them, color them, view and edit the relationships between notes, surface what's blocked, filter as you type, and flip the same board into a calendar to schedule the work. Everything is driven by your existing note properties, and every change is written straight back to your frontmatter. Define your note types yourself, or let the [Obsidian Starter Kit](https://store.dsebastien.net/) plugin configure them for you when it's installed.

> Requires Obsidian 1.13+ (the Bases view API). Desktop only (mobile isn't supported yet).

## Screenshots

A Base read as a board. A configurable status property drives the columns, and each card shows the properties from your Bases view:

![Kanban board](docs/images/board.png)

The same idea on a large task base, with collapsed columns keeping the backlog out of the way:

![Tasks board](docs/images/board-tasks.png)

Split the board into swimlanes by note type or any property (here, by priority):

![Swimlanes](docs/images/swimlanes.png)

Flip that exact board into a calendar to schedule work, plotting scheduled dates and deadlines together:

![Calendar mode](docs/images/calendar.png)

Or into a Gantt-style timeline that places each card by its start date and estimate, with cards grouped by note type and status in the Unplanned panel:

![Timeline mode](docs/images/timeline.png)

Break the same work down as a WBS tree, with estimates, progress, and dates rolling up the hierarchy (own values win, the rest derives from the children):

![WBS mode](docs/images/wbs.png)

Filter as you type with a compact query language:

![Filter as you type](docs/images/filter.png)

When a backlog gets overwhelming, work through it one card at a time in Triage mode:

![Triage mode](docs/images/triage.png)

Let the board do the bookkeeping with per-note-type automation rules — enter a done state and the progress, dates, tags, or even the note's folder update themselves:

![Automation rules](docs/images/automations.png)

Configure statuses, colors, relationships, and archiving per note type, synced from the Obsidian Starter Kit when it's present:

![Note types](docs/images/note-types.png)

## Install

**From Community plugins** (once listed): go to **Settings → Community plugins → Browse**, search for **Kanban Action Planner**, install, and enable.

**Manually:** download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/dsebastien/obsidian-kanban-action-planner/releases) into `<vault>/.obsidian/plugins/kanban-action-planner/`, then enable the plugin in **Settings → Community plugins**.

Then add a **Kanban** view to any [Base](https://help.obsidian.md/bases). See the [usage guide](./docs/usage.md) for the full walkthrough.

## Highlights

- **Kanban view in Bases.** Add one or more Kanban views to any Base. The Base's own filters select the notes.
- **Embed a board in any note.** `![[Tasks.base#Kanban]]` renders the view inside a markdown note, bounded and scrolling internally. The wikilink alias overrides that one embed — `|mode=wbs height=400 filter=status:active` — without ever touching the saved view: mode switches and filter edits inside an embed stay in the embed.
- **Status to columns, defined not guessed.** A configurable status property places cards into columns you define (per view, from the Starter Kit, or in settings), so a typo can't create a stray column. Unmapped notes collect in an "Unmapped" column that hides itself when empty.
- **Move, reorder, sort.** Drag a card to another column to change its status, or reorder within a column (written to a configurable `manual_order` property). Send a card straight to the top or bottom of its column from the right-click menu. Auto-sort each column by name or any property, including a base formula like a `priority_score`, ascending or descending. Full keyboard support (move, reorder, menu) and command-palette commands.
- **Filter as you type.** A toolbar search box with a compact, Jira-like query (`status:active OR due:overdue`, `parent:"PKM" -tag:archived`), saved per view, in both board and calendar mode.
- **Triage mode.** Work through an overwhelming backlog one card at a time, setting priority, urgency, effort, and the rest from one-click controls. It doubles as a spaced-repetition review queue, surfacing cards whose review is overdue.
- **Relationships, viewable and editable.** Parent, sibling, child, and `blocked_by` via link-properties (plus an optional tag and link heuristic). Navigate them, add or remove them from the card menu, flag and filter blocked items. An archived blocker stops blocking.
- **Focus on a card's children or whole subtree.** Zoom into a project (card menu or the ▼ children badge) and the board re-filters to just its children — or all its descendants — in the usual columns. Zoom up from a task via its ▲ parents badge to see the whole project's children (or a goal's entire subtree) at once. A dismissible chip next to the filter box shows the focus; zooming again drills down a level.
- **Swimlanes.** Split the board into collapsible lanes by note type or any property, with an Ungrouped lane. Cross-lane drag rewrites the grouping property. A board mixing note types auto-groups by type, and **each type's lane gets its own columns, colors, and WIP limits** — a card's own note type is authoritative for its status, so a project can never be given a task status.
- **Calendar mode.** Flip a board into a scheduling calendar (day, week, month, quarter, year) that plots scheduled dates and deadlines together. Drag cards onto days to set `date_scheduled` or `date_due`, with an Unplanned / No-deadline panel and per-day zoom. In every scheduling panel (calendar, timeline, WBS), drag a card onto another status group to change its status in place. Cards with an estimate span every covered day (dimmed continuation chips).
- **Timeline mode.** A Gantt-style view placing each card by **start date + estimate** (no end date; days by default, or a per-note-type property/unit override — e.g. tasknotes-style `time_estimate` minutes, converted via a configurable minutes-per-day): a square without an estimate, a rectangle spanning it with a duration badge (`5d`). Drag to move the start, resize the right edge to change the estimate, the left edge to shift the start (end stays anchored) — with the to-be-written date shown live on every drag, resize, and drop. Milestone diamonds, a today line, a per-row red deadline line, Week/Month/Quarter/Year axis with Ctrl/Cmd+wheel zoom, a collapsible "Unplanned" side panel of cards grouped by note type and status, and per-type show/hide on mixed boards.
- **WBS mode.** A work-breakdown-structure view rendering your parent/child hierarchy as a collapsible tree — goal → projects → tasks — with per-node progress bars, estimates, due-date countdowns, and date spans. One rollup model: a note's own value wins, otherwise it derives from its children — so you can plan top-down, bottom-up, or both, and persist any rollup to the parent in one click (never double-counted). Give a note type a **done state** (a property + the value(s) that mean done, e.g. the Completed/Done statuses) and done notes count as 100% in the rollup — a goal with 2 of 4 tasks done shows 50% without any progress numbers. Siblings with planned dates order themselves chronologically. Works on any view: notes without relationships show as standalone rows, and parents excluded by the view's filters (a tasks-only view whose tasks belong to projects) appear as muted “outside view” context rows so the hierarchy keeps its shape. Drag rows to re-parent or onto the panel to detach (the relationship wikilink is rewritten for you), drag cards from the "Needs planning" backlog into the tree, set status/dates/estimates/progress from any row (click the status dot for a quick status menu; the estimate chip edits inline — type `3`, `2h`, or `0.5d` and press Enter), and distribute a parent's estimate across unestimated children.
- **Archiving.** Move finished cards into a placeholder-driven folder (`Archive/{{year}}` and more), manually or automatically when a card reaches a given status. Links are preserved.
- **Automation rules.** Per note type: "when a note enters (or leaves) a status, enters a done state, is archived, or a property crosses a condition (`progress ≥ 100`…) — do things": set or remove properties (values take `{{date}}`-style placeholders), add or remove tags, move the note to a placeholder-driven folder. Mark a task Done and its progress jumps to 100, the due date clears, and `date_completed` stamps itself — from any write path (drag, menu, bulk, triage), exactly once per transition, with no cascading rules.
- **Cards show your view's properties.** Each card renders the properties you've added to the Bases view (the standard **Properties** selection), labelled and in order. Ordinary properties and base formulas (`formula.…`) alike, so a computed value shows with no extra setup. Enum values are color-coded by rank (warm = top priority or urgency, cool = low) so the board reads like a heatmap, the `NN -` sort prefix is hidden, and a numeric score shows as an accent badge. The card title can come from any property instead of the note name (per view, with the note name as fallback) — handy when filenames are IDs or dated slugs.
- **Note types.** Reusable per-type config (statuses, colors, relationships, archiving, swimlanes). Define your own by tag, folder, or regex, or mirror them from the Obsidian Starter Kit when present.
- **Productivity touches.** Soft per-column WIP limits, multi-select with bulk set-status / archive / open, a compact mode showing titles only, overdue and due-today emphasis, an optional due countdown badge (`In 3d`, `2d overdue`, `Today`, color-coded by urgency and positionable on the title, a chip, the corner, or a footer), native hover preview, and per-view state remembered across reloads.
- **Your notes stay the source of truth.** Status, order, dates, relationships, and grouping are all written to frontmatter. Desktop only for now (mobile isn't supported yet), and respects reduced-motion settings.

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md). In short: `bun install`, then `bun run dev` (watch) or `bun run build` (production). Quality gate: `bun run tsc`, `bun run lint`, `bun test`, `bun run build`.

## License

MIT License. See [LICENSE](./LICENSE).
