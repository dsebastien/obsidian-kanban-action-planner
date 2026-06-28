# Kanban Action Planner

An Obsidian plugin that adds a **Kanban board view type to [Obsidian Bases](https://help.obsidian.md/bases)**, so any set of notes can be planned, tracked, and scheduled visually.

Map note statuses to columns, drag/sort/reorder cards (persisted back into the notes), customize colors, view and edit relationships between notes, surface blocked items, filter as you type, and flip the same board into a calendar to schedule work — all driven by your existing note properties. Define note types yourself, or let the [Obsidian Starter Kit](https://store.dsebastien.net/) plugin auto-configure them when it is installed.

> Requires Obsidian 1.13+ (the Bases view API). Works on desktop and mobile.

## Install

**From Community plugins** (once listed): **Settings → Community plugins → Browse**, search for **Kanban Action Planner**, install, and enable.

**Manually:** download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/dsebastien/obsidian-kanban-action-planner/releases) into `<vault>/.obsidian/plugins/kanban-action-planner/`, then enable the plugin in **Settings → Community plugins**.

Then add a **Kanban** view to any [Base](https://help.obsidian.md/bases) — see the [usage guide](./docs/usage.md).

## Highlights

- **Kanban view in Bases** — add one or more Kanban views to any Base; the Base's own filters select the notes.
- **Status → columns, defined not guessed** — a configurable status property places cards into columns you **define** (per view, from the Starter Kit, or in settings), so a typo can't create a stray column. Unmapped notes collect in an "Unmapped" column that hides itself when empty.
- **Move, reorder, sort** — drag a card to another column to change status, or reorder within a column (written to a configurable `manual_order` property). Or auto-sort each column by **name** or any **property**, ascending/descending. Full **keyboard** support (move, reorder, menu) and command-palette commands.
- **Filter as you type** — a toolbar search box with a compact Jira-like query (`status:active OR due:overdue`, `parent:"PKM" -tag:archived`), saved per view, in both board and calendar mode.
- **Relationships, viewable and editable** — parent / sibling / child / `blocked_by` via link-properties (plus an optional tag+link heuristic). Navigate them, **add/remove** them from the card menu, flag and filter blocked items; an archived blocker stops blocking.
- **Swimlanes** — split the board into collapsible lanes by note type or any property, with an Ungrouped lane; cross-lane drag rewrites the grouping property.
- **Calendar mode** — flip a board into a scheduling calendar (day / week / month / quarter / year) plotting scheduled dates **and** deadlines together; drag cards onto days to set `date_scheduled` / `date_due`, with an Unplanned / No-deadline panel and per-day zoom.
- **Archiving** — move finished cards into a placeholder-driven folder (`Archive/{{year}}` and more), manually or auto-triggered by a status; links are preserved.
- **Note types** — reusable per-type config (statuses, colors, cards, relationships, archiving, swimlanes). Define your own by tag/folder/regex, or mirror them from the Obsidian Starter Kit when present.
- **Productivity touches** — soft per-column **WIP limits**, **multi-select** with bulk set-status / archive / open, **overdue/due-today** card emphasis, native **hover preview**, configurable card fields/cover, and per-view state remembered across reloads.
- **Your notes stay the source of truth** — status, order, dates, relationships, and grouping are all written to frontmatter. Works on desktop and mobile, reduced-motion-aware.

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md). In short: `bun install`, then `bun run dev` (watch) or `bun run build` (production). Quality gate: `bun run tsc`, `bun run lint`, `bun test`, `bun run build`.

## License

MIT License — see [LICENSE](./LICENSE).
