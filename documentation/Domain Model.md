# Domain Model

The configuration domain model lives in `src/app/domain/profile.ts` as Zod schemas; the
TypeScript types are inferred from those schemas (`z.infer`) so schema and type never drift.
Stored config is validated against these schemas on load.

Derived runtime models live in `src/app/domain/board-model.ts` (pure, generic over the card
type, unit-tested with plain objects). `buildBoard(cards, columns, options)` returns a
`Board<T>`:

- **`Board<T>`** — `{ lanes: BoardLane<T>[], isMultiLane }`. `isMultiLane` is `false` when
  grouping is off **or** resolves to a single lane (renderer draws it chrome-free).
- **`BoardLane<T>`** — `{ lane: LaneDef, columns: BoardColumn<T>[], cardCount }`.
- **`LaneDef`** — `{ id, label, isUngrouped }`. `id` is the raw grouping value (so cross-lane
  drag can write it back) or `UNGROUPED_LANE_ID`; `label` strips any numeric sort prefix.
- **`BoardColumn<T>`** — `{ column: ColumnDef, cards: T[] }`; cards sorted by `order` (unset
  last), tie-broken by key.
- **`BoardCardBase`** — the minimal card the model reads: `{ key, statusValue, order,
laneValue? }`. The view's `KanbanCard` extends it with `file`/`title`/`display`.

Lanes are ordered by their value's numeric/lexical prefix; the `Ungrouped` lane (missing
grouping value) is hidden when empty and placed last by default — mirroring the Unmapped
column rule.

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
  `linkProperty`, and an optional secondary tag+link `heuristic`. Resolved at runtime by
  `domain/relationships.ts` into a **RelationshipSet** per note (`Record<role, string[]>`):
  direct link targets, **inverse** reverse lookup (`parent`↔`child`, `sibling` symmetric;
  `blocked_by` has no inverse), and the link-scoped heuristic (a tagged note linking to a
  source stands in that role). A missing rule uses the per-role default property; an explicit
  empty `linkProperty` disables link detection for that role (heuristic still applies).
  Relationships are read-only (never written back). `domain/filtering.ts` adds the **blocked
  filter** (`all`/`only`/`hide`) over the resolved sets.
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
