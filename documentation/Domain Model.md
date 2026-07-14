# Domain Model

The configuration domain model lives in `src/app/domain/note type.ts` as Zod schemas; the
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

- **Note type** — the reusable note-type configuration unit. Identifies how a note type is
  recognized (`typeRecognition.mappings`: tag/folder/regex) and carries everything needed to
  render and operate a board for that type: status/order property names, derived `columns`,
  swimlane grouping, colors, archiving, relationships, calendar config. (Card field content is
  not part of the note type — it comes from the Bases view's property selection, see #50.)
  `source` is `starter-kit` (mirrored, read-only origin) or `local`. `overrides` is a partial
  local override layer applied on top of a mirrored snapshot.
- **ColumnDef** — a board column derived from a status value: stable `id`, raw `statusValue`,
  display `label`, `sortKey` (numeric/lexical prefix), and a `ColorSpec`.
- **ColorSpec** — `{ kind: 'palette', token }` (resolved via Obsidian CSS vars) or
  `{ kind: 'hex', value }`.
- **LaneGrouping** (issue #2) — `none` | `note-type` | `property:<name>`; the dimension used
  for horizontal swimlanes.
- **CardDisplay** (issue #50) — built per card by `services/card-display.service.ts` from the
  Bases view's configured properties (`config.getOrder()`): the note name as `title`, one
  labelled `CardFieldView` per property (read via `BasesEntry.getValue`, labelled via
  `getDisplayName`, empty/`null` skipped), plus the `dueState`. No stored per-type config.
- **RelationshipRule** — a `role` (`parent`/`sibling`/`child`/`blocked_by`), a primary
  `linkProperty`, and an optional secondary tag+link `heuristic`. Resolved at runtime by
  `domain/relationships.ts` into a **RelationshipSet** per note (`Record<role, string[]>`):
  direct link targets, **inverse** reverse lookup (`parent`↔`child`, `sibling` symmetric;
  `blocked_by` has no inverse), and the link-scoped heuristic (a tagged note linking to a
  source stands in that role). A missing rule uses the per-role default property; an explicit
  empty `linkProperty` disables link detection for that role (heuristic still applies).
  Relationships are read-only (never written back). `domain/filtering.ts` adds the **blocked
  filter** (`all`/`only`/`hide`) over the resolved sets.
- **ArchiveConfig** (issue #7) — `archiveFolder` (supports `{{year}}`/`{{month}}`/`{{week}}`/
  `{{quarter}}`/`{{day}}`/`{{date}}`/`{{datetime}}`/`{{uuid}}` placeholders, resolved by the
  pure `utils/expressions.ts`) and an optional `triggerStatus`. Archiving is **per note type**
  (issue #29): each note type carries its own `archive`, and the view resolves a card's
  config by _its_ recognized type (`archiveByPath`, built from per-file `recognizeNoteType`), so a
  board mixing types files each card where it belongs; untyped cards (no Starter Kit) fall back to
  the default note type. Configure-board → Archiving renders a folder + trigger **per type present**
  on the board. Archiving **moves** the note via `services/archive.service.ts`
  (`fileManager.renameFile`, links preserved); manual via the card menu (shown only when the
  card's type has a folder), or auto when a card **transitions into** its type's `triggerStatus`
  (opt-in, guarded). Blank `archiveFolder` disables archiving for that type; name clashes get a
  numeric suffix.
- **CalendarConfig** — scheduled/due date property names, momentjs `dateFormat`, default
  range, and tab sort key. Calendar mode (per-view `calendarMode` toggle) is driven by pure
  helpers: `domain/calendar.ts` (`CalendarRange`, month/week grid building with a configurable
  **first day of week** — `startOfWeek`/`weekdayLabels` keyed off the global `firstDayOfWeek`
  setting, `parseFrontmatterDate`, `bucketByDay`, `shiftAnchor`, `addDays`, `formatLongDate`)
  and `domain/calendar-tabs.ts` (`matchesQuery` + `compareTabCards` for the panel's
  filter/sort). The grid shows **both date dimensions at once** — each card is plotted on its
  `scheduled` day (blue) _and_ its `deadline` (orange; split-edge if same day, red if overdue) —
  so a card with both dates appears twice. The panel tabs are backlogs (cards missing each date)
  and choose which date a panel drag sets; a dragged calendar chip moves _its own_ dimension's
  property (formatted via `utils/momentjs.ts`), dragging back to the panel clears it; a toolbar
  legend filters each dimension (`ui/calendar/*`). Dates are also settable from the card
  right-click menu (today / tomorrow / pick-a-date / clear).
  **Day view / zoom:** the range switcher has a first-class **Day** entry (focuses today); a day
  number click zooms into that specific day. Both set `focusedDay` in the renderer model →
  a single-day list with ‹ Back + ‹/Today/› day nav and the range switcher (Day active). The
  focus list keeps the `.kap-cal-day`/`data-day` contract so the same `CalendarDnd`
  schedules/clears dates there.
  Calendar/lane UI state (range override, anchor, focused day, active tab, panel/lane collapse)
  is currently in-memory per session.

- **WbsNode / WBS rollups (issue #76)** — `domain/wbs.ts` (pure, unit-tested).
  `buildWbsForest(paths, childrenOf, parentsOf, compare)` derives the WBS forest from the
  resolved relationships: roots have no in-set parent (a note with no relationships roots a
  childless standalone row — approved rule-36 exception), multi-parent notes duplicate under
  each parent, cycles stop where a branch re-enters itself. `collectContextAncestors`
  discovers out-of-set ancestors (existing vault notes referenced by in-set parents, climbed
  per-note via each ancestor's own type's parent property) so filtered views keep their
  hierarchy as display-only context rows; out-of-set children are intentionally excluded. One rollup model
  for estimates and progress: **a note's own value wins; without one it derives from its
  children** (`effectiveEstimate`/`childrenEstimate`, `effectiveProgress` — weighted by
  effective estimates; `parseProgress` clamps to 0–100). `subtreeSpan` derives a parent's
  date span from its subtree; `distributeEstimate` splits an own estimate top-down over
  estimate-less children. Derived values are display-only until explicitly persisted
  ("Save rolled-up …").

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
global default property names, the default date format, and the local `note types` store
(empty until a board is configured or a Starter Kit type is mirrored).
