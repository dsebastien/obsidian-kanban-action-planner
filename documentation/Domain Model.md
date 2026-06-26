# Domain Model

The configuration domain model lives in `src/app/domain/profile.ts` as Zod schemas; the
TypeScript types are inferred from those schemas (`z.infer`) so schema and type never drift.
Stored config is validated against these schemas on load. Derived runtime models
(`CardModel`, `Lane`, `BoardModel` — which reference `BasesEntry`/`TFile`) arrive with the
board renderer (Milestone 1) in `board-model.ts`.

## Core terms

- **Profile** — the reusable note-type configuration unit. Identifies how a note type is
  recognized (`typeRecognition.mappings`: tag/folder/regex) and carries everything needed to
  render and operate a board for that type: status/order property names, derived `columns`,
  swimlane grouping, colors, card presentation, archiving, relationships, calendar config.
  `source` is `starter-kit` (mirrored, read-only origin) or `local`. `overrides` is a partial
  local override layer applied on top of a mirrored snapshot.
- **ColumnDef** — a board column derived from a status value: stable `id`, raw `statusValue`,
  display `label`, `sortKey` (numeric/lexical prefix), and a `ColorSpec`.
- **ColorSpec** — `{ kind: 'palette', token }` (resolved via Obsidian CSS vars) or
  `{ kind: 'hex', value }`.
- **LaneGrouping** (issue #2) — `none` | `note-type` | `property:<name>`; the dimension used
  for horizontal swimlanes.
- **CardPresentation** (issues #3–#6) — `titleSource` (note name or a property), ordered
  `fields` (`CardFieldDisplay`), optional `coverImageProperty`, and `wrapPropertyValues`.
- **RelationshipRule** — a `role` (`parent`/`sibling`/`child`/`blocked_by`), a primary
  `linkProperty`, and an optional secondary tag+link `heuristic`.
- **ArchiveConfig** (issue #7) — `archiveFolder` (supports `{{year}}`/`{{week}}`/… placeholders)
  and an optional `triggerStatus` for auto-archiving.
- **CalendarConfig** — scheduled/due date property names, momentjs `dateFormat`, default
  range, and tab sort key.

## Property semantics

- **Status** drives columns. Auto-detection prefers a property literally named `status`,
  else any property whose name contains `status`. When sourced from the Starter Kit, the
  status property's `allowedValues` become the column set.
- **Order** (`manual_order` by default) is persisted to the note as a fractional float; new
  positions are midpoints between neighbours (per-column scope).
- **blocked_by**, **date_scheduled**, **date_due** are property names (configurable) used by
  relationships and calendar mode respectively.

## Settings shape

`src/app/types/plugin-settings.intf.ts` (`pluginSettingsSchema`) holds a `schemaVersion`,
global default property names, the default date format, and the local `profiles` store
(empty until a board is configured or a Starter Kit type is mirrored).
