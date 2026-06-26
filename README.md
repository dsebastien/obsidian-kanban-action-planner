# Kanban Action Planner

An Obsidian plugin that adds a **Kanban board view type to [Obsidian Bases](https://help.obsidian.md/bases)**, so any set of notes can be planned, tracked, and scheduled visually.

Map note statuses to columns, reorder cards (persisted back into the notes), customize colors, model relationships between note types, surface blocked items, filter relationally, and flip the same board into a calendar to schedule work — all driven by your existing note properties, with optional auto-configuration from the [Obsidian Starter Kit](https://store.dsebastien.net/) plugin when it is installed.

> Status: in development. See [`documentation/plans/`](./documentation/plans/) for the build plan.

## Highlights (planned for 1.0)

- **Kanban view in Bases** — add one or more Kanban views to any Base; the Base's own filters select the notes.
- **Status → columns** — columns are derived from a configurable status property; unmapped notes collect in an "Unmapped" column that hides itself when empty.
- **Manual ordering persisted to notes** — drag to reorder; order is written to a configurable property, not to plugin data.
- **Drag & drop and right-click** to change status, with smooth, reduced-motion-aware animations.
- **Note-type profiles** with per-status colors, auto-detected and mirrored from the Obsidian Starter Kit when present.
- **Configurable cards** — choose the title source, body fields, an optional cover image, and value wrapping; due dates always flagged in red.
- **Swimlanes** — split the board into collapsible lanes by note type or any property, with an Ungrouped lane; cross-lane drag rewrites the grouping property.
- **Relationships** — parent / sibling / child and `blocked_by` via link-properties (with an optional tag+link heuristic), used for filtering, blocked-item flagging, and navigation.
- **Calendar mode** — a toggle that turns the board into a scheduling calendar (week / month / quarter / year) with an Unplanned / No-Deadline panel; drag cards onto days to set `date_scheduled` / `date_due`.

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md). In short: `bun install`, then `bun run dev` (watch) or `bun run build` (production). Quality gate: `bun run tsc`, `bun run lint`, `bun test`, `bun run build`.

## License

MIT License — see [LICENSE](./LICENSE).
