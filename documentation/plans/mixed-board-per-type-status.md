# Mixed boards: per-type lanes/columns, card type authoritative for status writes

Owner decision (explicit approval for Business Rules 2 & 7 amendments): **on a mixed board, a
card's own note type is authoritative for every status write** — a card is never assigned a
status outside its own type's vocabulary, and status reads/writes use the card's own type's
status property.

Diagnosis that drove this: the board resolved ONE dominant note type (first-20-file sample of
the unfiltered Base result) and used it for the column set, status property, and lane default —
so mixed boards blurred types into one column set (foreign statuses → Unmapped, or silent
interleaving for identical vocabularies), and drops wrote the dominant type's values onto
foreign-type notes.

## Implemented

- **Auto note-type lanes**: `resolveEffectiveLaneGrouping` (pure, `view-config.ts`) — no per-view
  override + profile grouping `none` + >1 recognized type ⇒ `{kind:'note-type'}`. Explicit
  per-view `None` still disables lanes.
- **Per-lane column sets**: `buildBoard` gained `columnsForLane?(laneId)` (lane id = the type
  NAME; `UNGROUPED_LANE_ID` for the catch-all). View builds `columnsByLane` from each visible
  type's own `columns` (else global `defaultStatuses`) via `columnsFromValues(values, laneType,
true)` → per-type colors + WIP limits. A per-view `statuses` list is the legacy whole-board
  override and forces one shared set (`perLaneColumnsActive()`).
- **Status reads**: `toCard` reads via `statusPropertyForFile` — per-view `statusProperty`
  override (top, all cards) → card's own type's `statusProperty` → board-wide fallback.
- **Status writes** (all paths through the card's own property + vocabulary):
    - DnD: `handleDrop` resolves the value from the target lane's set
      (`columnStatusValue(columnId, laneId)`); cross-lane drops on note-type lanes stay refused.
    - Card menu: `CardMenuHost.columnsFor(card)` (was `columns()`) — own type's set in any mode.
    - Keyboard move: already lane-local (`target.column.statusValue`).
    - Bulk multi-select: `columnsForSelection(cards)` — same-type selections only, else a Notice;
      writes per card via `statusPropertyFor`.
    - `applyMove`: `statusPropertyFor(card)` everywhere (incl. the auto-archive branch, which
      already compared the card's own type's triggerStatuses — now receives own-vocab values).
    - Enum quick-set menu excludes the card's own status property.
- **Column reorder guard**: drag-reorder on a per-lane board shows a Notice and snaps back
  (persisting a single `statuses` list would force the shared-set mode).
- Column collapse state stays keyed by column id: a value shared by two types collapses in both
  lanes (accepted). Column anchor restore is best-effort per lane.

## Out of scope (follow-ups)

- Relationship `roleProperties` still resolve from the dominant type (known limitation).
- Calendar/timeline date-property resolution stays board-wide (dominant type fallbacks).
- Per-type column-reorder persistence (`statusesByType` per-view record).
- Recomputing the dominant type from the filtered set (moot with per-lane columns).

## Status

- [x] Domain (`columnsForLane` + `resolveEffectiveLaneGrouping` + 9 specs)
- [x] View/UI wiring (kanban-view, card-menu, board-selection, options copy)
- [x] Docs (Business Rules 2/7 amendments, usage, READMEs)
- [x] Live-vault validation (mixed fixtures: per-type lanes/columns, per-type writes,
      bulk restriction, reorder guard, single-type regression)
- [x] Committed and pushed (66ceb8d)
