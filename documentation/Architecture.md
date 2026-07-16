# Architecture

High-level architecture of the Kanban Action Planner plugin. For the full phased build
plan see [`plans/kanban-action-planner-implementation-plan.md`](./plans/kanban-action-planner-implementation-plan.md);
for invariants see [`Business Rules.md`](./Business%20Rules.md).

## Entry points

- `src/main.ts` — default-exports the plugin class only.
- `src/app/plugin.ts` — `KanbanActionPlannerPlugin`: settings load/save (Zod-validated,
  Immer-immutable), registers the Bases view, adds the settings tab.

## The Bases view

The core is a custom Obsidian **Bases view** (Obsidian ≥ 1.13.0 API):

- Registered via `Plugin.registerBasesView(KANBAN_VIEW_TYPE, { name, icon, factory, options })`.
- `factory: (controller, containerEl) => KanbanActionPlannerView` — the view mounts all its
  DOM inside `containerEl`.
- `KanbanActionPlannerView extends BasesView` implements `type`, `onload`, `onunload`, and
  `onDataUpdated`. The filtered note set is read from `this.data.data` (a `BasesQueryResult`
  whose `BasesEntry` objects expose `.file: TFile` and `.getValue(propertyId)`); it is
  **replaced** on every update and never cached. Per-view state is persisted via
  `this.config.get/set`.
- **Filter bar (issue #34).** A "JQL-lite" query, parsed by the pure, unit-tested
  `domain/filter-query.ts` (`parseFilterQuery` → OR-of-AND-groups AST; `matchesFilterQuery`
  over a per-card `CardSearchRecord`). `services/card-search.service.ts` (`buildCardSearchRecord`,
  unit-tested) builds one `CardSearchRecord` per card from the metadata cache (lowercased title,
  relationship names, tags, all frontmatter values, status value+label, parsed due date) so
  keystroke matching does no file reads. `rebuild()` derives
  the unfiltered `allCards` + records once; `applyFilterAndRender()` filters and renders, and is
  also called directly (debounced ~150 ms) on a filter keystroke — so typing re-renders without
  re-deriving cards/relationships. The filter input is a **persistent** toolbar element
  (`ui/filter-bar.ts`) in its own slot between the re-rendered mode-switch (left) and actions
  (right) slots, so it never loses focus. The query persists per-view in `config.filterQuery`;
  it applies in both board and calendar mode and replaced the old `calendarFilter` option.
- **Live config propagation.** The plugin tracks open views in a `Set` (`trackKanbanView` /
  `untrackKanbanView`, wired in the view's load/unload). `saveSettings()` — the single sink for
  every note-type/settings write — calls `view.onSettingsChanged()` (debounced rebuild) on each,
  so a note-type edit (colors, swimlanes, relationships, archiving) refreshes every open board
  immediately. Card **fields** come from the Bases view's property selection (#50), not the note
  type, so they update through the normal Bases view update when you change the view's properties.

## Layering (target)

```
views/kanban/      Bases view + options panel + extracted controllers/builders via small host
                   interfaces (board-selection.ts owns multi-select/bulk; calendar-controller.ts
                   owns calendar state + rendering + drag; card-menu.ts builds the card context
                   menu; more to follow)
ui/                vanilla-DOM renderers: board, calendar, view toolbar, gear, folder suggest, modal (no UI deps)
services/          side-effectful adapters: frontmatter R/W, Starter Kit API, note types, colors, archive
domain/            pure, unit-tested logic: status, ordering, relationships, filtering, calendar, board model
settings/ + types/ plugin settings (Zod schema + defaults) and the settings tab
utils/             logging, date formatting, placeholder expressions, small DOM helpers
constants.ts       view type id, CSS scoping tokens, default property names
```

Rule of thumb: `domain/` is pure and tested with `bun test`; `services/`/`ui/` hold the
side effects and DOM, verified manually in Obsidian.

## Config flow

Three layers resolved by the note-type service, in precedence order:
**per-view `this.config` → local note type → Starter Kit mirror → built-in defaults.**
When the Starter Kit plugin is present, its note-type config is the read-only source of
truth, mirrored into a local snapshot in plugin settings so it survives SK being disabled.

**Property access (issue #50).** A `type:'property'` option stores a `BasesPropertyId`
(`note.*`/`formula.*`/`file.*`). `views/kanban/property-access.ts#parsePropertyRef` splits these
into **note** (frontmatter, read via the metadata cache, **writeable**) vs **computed**
(`formula.*`/`file.*`, read per card via `BasesEntry.getValue` — the view keeps a per-`rebuild()`
`entriesByPath` map since `this.data` is replaced each update — **read-only**). `unwrapValue` turns
a Bases `Value` into a sortable/groupable scalar. **Sort** and **swimlane grouping** accept computed
columns (their pickers use a read-only filter); writeable settings (status, order, drag-grouping)
stay `note.*`-only. So the plugin can leverage a base's own formulas (e.g. a `priority_score`)
without depending on any specific base.

**Note-type recognition (issue #31).** A file's type is resolved by `recognizeNoteTypeFor`:
Starter Kit recognition first (when present), then **local mapping rules** — the pure
`domain/note-type-recognition.ts` matches a file (path + tags) against each non-Default note type's
`typeRecognition.mappings` (tag / folder / regex). So locally-defined types (created in Settings →
Note types) and orphaned SK types both recognize without the Starter Kit, driving per-file
swimlane/archive/display and the dominant-type active note type.

## Styling / isolation (hard rule)

Tailwind v4, hardened for Obsidian plugin isolation the same way the sibling
`../obsidian-journal-base` plugin does. Four mechanisms (see the plan's "Styling: Tailwind +
isolation" hard rule for the full rationale and canonical header):

1. **No preflight** — the global reset is never imported.
2. **Plugin-prefixed cascade layers** — `@layer kap-theme, kap-base, kap-components,
kap-utilities;` (generic layer names are shared between plugins and let one reorder
   another's rules).
3. **`theme(reference)`** on `@import 'tailwindcss/theme'` — builds utilities from the design
   tokens **without** emitting a global `:root { --… }` block (verify: `grep ':root'
dist/styles.css` finds none).
4. **`.kap-root` + `kap-` scoping** — every node lives under `.kap-root`, every class is
   `kap-`-prefixed, every rule sits in `@layer kap-components`, and colors use Obsidian CSS
   variables via `var(--…)` only.

Edit only `src/styles.src.css`; the root `styles.css` is generated.

## Current state

Through Milestone 4: a working board with columns from a status property, an Unmapped column,
pointer-event drag/drop and reorder persisted to notes, a right-click menu, note-type
**note types** (mirrored from the Obsidian Starter Kit when present), a **color** system applied
to cards/columns, **card fields from the Bases view's property selection** (#50 — note props,
`formula.*`, and `file.*` alike), **configurable
swimlanes** (group by note type or a property, with collapsible lanes and an Ungrouped lane;
cross-lane drag rewrites the grouping property), **relationships** (parent/sibling/child/
blocked_by detection with inverse lookup + a tag+link heuristic, blocked-by flag/navigation, and
a blocked filter), per-view options, a tabbed Configure-board modal, and global settings.
**Archiving** (folder with placeholders + optional auto-archive on status) and **calendar mode**
(scheduling panel + grid, deadline highlighting, responsive auto-collapse) are also implemented.
**Enum quick-set** (#52 — a generic "Set <property>" card menu driven by `services/enum.service.ts`,
allowed values from manual note-type config or the Starter Kit) and **triage mode** (#53 — a third
Board/Calendar/Triage view mode; a worst-first one-card-at-a-time clarify / re-prioritize / **due-for-
review** (#57) queue, pure logic in `views/kanban/triage.ts`, UI in `ui/triage/`, per-view config
edited via the **Configure triage** modal with note-type-sourced property pickers; a left queue
pane — the shared `kap-scheduling-panel` shell — lists the snapshot grouped by note type → status
(`groupByTypeAndStatus`), click-to-select moving the cursor) round out the set.
Triage gating is **type-aware** for mixed boards: a gating prop only flags a card whose note type
defines it. Review property names (`last_reviewed`/`review_interval`/`review_count`) are global
settings; the "Reviewed" action stamps the date + bumps the count.

The board pipeline: `domain/board-model.ts` `buildBoard()` is pure and unit-tested (buckets
cards into `BoardLane[] → BoardColumn[]`, `isMultiLane` flag; an optional `compare` comparator
sets the in-column order, defaulting to manual `manual_order` — issue #17). The view builds that
comparator from the per-view **Card sort** options via the shared pure `compareTabCards`
(`domain/calendar-tabs.ts`), and suppresses `manual_order` writes while a non-manual sort is active.
`ui/board/board-renderer.ts`
renders chrome-free for a single lane or collapsible `.kap-lane` swimlanes otherwise;
`ui/board/dnd-controller.ts` reports `{ laneId, columnId, index }` drop targets; the view
(`views/kanban/kanban-view.ts`) resolves grouping + per-file lane values, computes relationships,
applies the blocked filter, and persists status/order/grouping-property writes via
`services/frontmatter.service.ts`.

**Incremental refresh (M6).** The view calls `patchBoard()` (not a full re-render) on every
update. When the lane/column **shape** is unchanged (a `data-board-struct` signature on the
host matches), each column's card list is reconciled by the pure, unit-tested
`ui/board/reconcile.ts` `planReconcile()` over `data-card-key` + a content `data-card-sig`.
Both signatures are the pure, unit-tested `ui/board/signatures.ts` (`structureSignature` /
`cardSignature`):
unchanged cards keep their exact DOM node (so scroll, focus, and an in-flight drag survive),
only changed/new cards are rebuilt, gone cards removed, and order is fixed with a React-style
cursor. Shape changes (config edits, a new status column, calendar↔board switch, the empty
state) fall back to a full `renderBoard()`. Lane collapse/counts are synced in place. **Scroll
preservation across teardowns (issues #12, #105):** only on a structure flip
(`boardStructureWillChange()` — the patch path preserves scroll by node identity) the view
captures, per lane, the leftmost on-screen column + offset
(`captureColumnAnchors`/`restoreColumnAnchors`, skipping collapsed 0×0 lanes) plus every
column's and the lane stack's vertical scrollTop keyed by lane+column id
(`ui/scroll-preservation.ts` `captureBoardScroll`/`restoreBoardScroll`), and pins both back
right after the full render, in the same task. The calendar/timeline controllers wrap their
full-teardown renderers the same way with selector-keyed snapshots
(`CALENDAR_SCROLLER_SELECTORS`/`TIMELINE_SCROLLER_SELECTORS`). Restores clamp to the new
extent and skip no-op writes; the pure helpers are unit-tested
(`ui/scroll-preservation.spec.ts`). **Sizing
invariants:** every column is a fixed equal width; cards are a single uniform height board-wide,
computed at runtime by `ui/board/card-equalize.ts` `applyUniformCardHeight()` as the tallest
card's natural height (published as the `--kap-card-height` CSS var, applied as `min-height`;
re-run after every `patchBoard` and on resize; the clear→measure→set cycle snapshots each
column/lane scroller's scrollTop first and restores it after the re-set, so the intermediate
shrunken layout never clamps it away). Cards never shrink below their content
(`flex: none`) so nothing is clipped — the column body scrolls instead; sparser cards get
matching whitespace. The pure max-picking helper `uniformCardHeight()` is unit-tested.

**Render-signature gate (issue #105).** Before the board/calendar/timeline render (and its side
effects: toolbar teardown, calendar/timeline full teardown, column-anchor restore, equalize,
refocus, selection refresh), `applyFilterAndRender` computes a deterministic signature of
everything the pass would draw (`skipUnchangedRenderPass`/`renderPassSignature` in the view;
pure `boardRenderSignature`/`renderPassSignature` in `ui/board/signatures.ts`;
`renderStateSignature()` on the calendar/timeline controllers). When it matches the last
completed pass and the mode's DOM is mounted, the pass is a true no-op — this absorbs the Bases
echo of the plugin's own frontmatter/config writes, body-only edits, and irrelevant settings
fan-out. Calendar/timeline signatures also hash each card's raw frontmatter + tags because those
renderers read the note at render time. The model bookkeeping (`cardsByKey`, `this.board`,
filter count/zoom chip) still refreshes on skipped passes. Optimistic in-memory mutations change
the signature by construction, so their immediate render always proceeds; a pending keyboard
refocus forces a render. The signature is committed only when the pass **finishes**
(`commitRenderPass`) — a renderer throwing partway leaves it cleared, so the next trigger repaints
over the partial DOM. Multi-file write sequences (drag renumber, bulk status/archive) run inside
`withRebuildsSuppressed`, deferring the non-resetting 250ms data-event debounce to the end of the
sequence so a mid-sequence rebuild can never render a partial on-disk state. Every optimistic
mutation path resolves its card through `liveCard()` first — reused DOM nodes keep handlers that
close over pre-rebuild card objects, whose mutation no render would see. Failed writes roll back
precisely: `applyLaneChange` reverts the lane value, bulk paths revert/restore only the cards
whose write failed. Triage keeps its own `lastTriageSignature` guard inside `renderTriage`;
WBS is ungated (both branches reset the pass signature so a later gated mode always renders over
their DOM).

**Hover preview.** The plugin registers a hover-link source (`registerHoverLinkSource`, Mod-gated by
default) and a delegated `pointerover` on the board host triggers the core Page-preview popover for
the card under the pointer (the view implements `HoverParent`).

**View chrome & responsiveness.** The view root (`.kap-root`) is a flex column: a top
`.kap-toolbar` over a flex-1 `.kap-board-host`. `ui/view-toolbar.ts` renders a **Board / Calendar
mode switch** (left; persists `calendarMode` via `this.config.set`) and right-side actions — the
**up/down swimlane nav** (shown only with >1 lane; `scrollLane(±1)` jumps the `.kap-lanes`
container) and the configure **gear**. The toolbar is re-rendered from `rebuild()` (once
`this.config` exists). Active-state button highlights use layered `!important` because Obsidian's
unlayered `<button>` styles outrank any layered rule. **Collapse** is two-axis: lanes collapse
vertically (per-lane id) and **columns** collapse horizontally to a labelled vertical bar (per
status id, applied across every lane) — both tracked as in-memory `Set`s on the view and threaded
through `renderBoard`/`patchBoard`. Swimlanes are content-sized but capped at one screen
(`max-h-full`), scrolling their columns internally.

**Calendar mode.** When `calendarMode` is on, `rebuild()` calls `renderCalendarFrame()` instead of
the board: `ui/calendar/calendar-renderer.ts` draws a collapsible **Scheduling** panel (its backlog grouped by note type → status via the
shared `groupByTypeAndStatus`, reusing the timeline's tab-style group headers) plus a
CSS-grid calendar (`grid-template-columns: repeat(7, minmax(0, 1fr))` so every day stays visible
and chips truncate). **Unified overlay:** the grid plots every card on **both** its scheduled day
_and_ its deadline — `cardsByDay` is a `Map<dayKey, CalendarEntry[]>` where each entry carries a
`kind` (`scheduled` blue / `deadline` orange / `both` split-edge when same day) and an `overdue`
flag (deadline before today → red). A card with two dates appears twice. The panel's two tabs are
now just **backlogs** (cards missing each date) and decide which date a _panel drag_ sets; a
toolbar **legend** doubles as a per-dimension filter (`showScheduled`/`showDeadlines`). DnD:
`ui/calendar/calendar-dnd.ts` reads the dragged chip's `data-dimension` and reports it, so
dragging a chip moves _its own_ date (`both` moves both); dropping on the panel clears it
(day-sourced chips only). **Pane-group drag (rule 37, all scheduling panels):** the panel's
status subgroup headers + card areas carry `data-pane-drop-type`/`-status`; dropping a
PANE-sourced card there sets that status — validity + commit live on the view
(`resolvePaneGroupDrop` in `domain/pane-drop.ts` → `setCardStatus`), same-type only, shared
by `calendar-dnd`, `wbs-dnd`, and the timeline's `makeCardSchedulable`.
Scheduling is also reachable from the **card right-click menu** (Schedule / Set deadline →
today / tomorrow / pick-a-date via `ui/date-prompt-modal.ts` / clear), on the board too. A
`ResizeObserver` on the board host **auto-collapses the panel** when the container is narrower
than ~36rem and restores it when there's room (only on a width-category change; a manual toggle
clears the auto state). **Persisted per-view across reloads (issue #19):** range override, active
tab, panel-collapsed, and the two legend toggles are written to `this.config`
(`calendarRangeOverride`/`calendarTab`/`calendarPanelCollapsed`/`calendarShowScheduled`/
`calendarShowDeadlines`) — the `CalendarController` loads them lazily on first render (config is
unavailable at construction, like the view's `loadFilterQuery`) and writes on each change. The view
likewise persists `collapsedLanes`/`collapsedColumns` (loaded once in `rebuild()`, written on
toggle). **Transient (reset on reload):** the anchor (→ today), the focused day (→ none), and the
auto-collapse runtime memo.

**Timeline mode (issues #77, #80 + estimate rework).** Same three-layer split: pure math in
`domain/timeline.ts` (bar geometry in % of the window from start + derived end
(start + estimate − 1); `inclusiveDays(start, end)` is the single source of the inclusive-day
convention — `totalDays` delegates to it; `parseEstimate(raw)` accepts numbers or numeric
strings, `Math.ceil`s, and returns ≥ 1 or `null`; `resizeFromStart(estimate, dayDelta)` clamps
the **shared** delta once (`min(dayDelta, estimate − 1)` for positive deltas) and derives
`{ startDelta, estimate }` from it, so a left resize can never push the start past the anchored
end; `resizeEstimate(estimate, dayDelta)` is `max(1, estimate + dayDelta)`;
`groupByTypeAndStatus(items, typeOf, statusOf)` builds the Unplanned panel's type → status
groups; `zoomRange(kind, direction)` steps week↔month↔quarter↔year and returns `null` at the
ends). DOM in `ui/timeline/timeline-renderer.ts`, which only reports intent via callbacks; the
live drag/resize/drop labels are produced by a controller closure
`labelForDayOffset(offset: number)` (works for any signed offset, so clipped bars and
off-window drags stay correct), and the floating drag label and the unplanned-card drag **ghost** (width-capped)
are appended to `ownerDocument.body` inside a `.kap-root`-classed wrapper (nothing inside the
track/panel, which clip; popout-safe). Unplanned cards live in a **collapsible left panel** (titled "Unplanned", matching the calendar)
reusing the calendar's shared `kap-scheduling-panel` shell (plus a `kap-tl-panel` modifier);
`panelCollapsed` is part of `TimelineViewState`, persisted per view under the
`timelinePanelCollapsed` config key, and `evaluatePanelAutoCollapse` mirrors the calendar's
narrow-pane auto-collapse (manual choice wins). State and frontmatter writes in
`views/kanban/timeline-controller.ts` (mirrors `CalendarController`): it resolves the
start/estimate/milestone properties, commits a left-edge resize as start + estimate in **one**
frontmatter transaction via the new `setProperties(app, file, record)` helper in
`frontmatter.service.ts` (single `processFrontMatter` call), writes only the estimate on a
right-edge resize and only the start on move/drop, and deletes only the start (never estimate
or milestones) on unschedule. Collapse state — unplanned type/status groups and timeline type
group rows — lives on the controller instance (survives frontmatter-write rebuilds, not
persisted); hidden types persist by type id in a dedicated `timelineHiddenTypes` config key
(own `restoreHiddenTypes()`/`persistHiddenTypes(ids)` host pair, validated as a string[]),
deliberately outside `TimelineViewState` so `persistState({ range })` calls can't clobber it.
Zoom persists via the existing `timelineRangeOverride`. Context menus reuse `card-menu.ts`
through an optional `extend(menu)` hook (`kap-timeline` section).

**WBS mode (issue #76).** A fifth view mode (`wbsMode` flag, `toggle-wbs-mode` command) with
the same three-layer split: pure math in `domain/wbs.ts` (`buildWbsForest` — roots = no
in-set parent (loose notes render as childless depth-0 rows — approved rule-36 exception),
per-branch cycle guard, multi-parent duplication; `collectContextAncestors` — discovers
out-of-set ancestors from the in-set parents and climbs further via each note's OWN type's
parent property (`WbsHost.parentPropertyForPath` → `recognizeLocalNoteType` +
`roleProperties`), so filtered views render muted display-only **context rows** (drop
targets, derived rollups, `data-wbs-context` opts them out of drag sourcing);
`effectiveEstimate`/`childrenEstimate` — **own value wins, else recursive children rollup**,
so persisting a rollup never double-counts; `effectiveProgress` — own > 0 wins, else the
children's combination weighted by effective estimates; `subtreeSpan` — derived date span;
`distributeEstimate` — top-down split over estimate-less children; `parseProgress` — 0–100
clamp; `buildWbsNode` — single-path twin for menu-time math). DOM in `ui/wbs/wbs-renderer.ts`
(shared `kap-scheduling-panel` shell + the calendar's exported `renderGroupHeader` for the
"Needs planning" backlog; one flat `.kap-wbs-row` per visible node with `data-card-key` /
`data-parent-key`; fixed-width right-aligned meta chips so progress bars / dates / estimates
column-align across rows). State + writes in `views/kanban/wbs-controller.ts` (mirrors
`TimelineController`: lazy `ensureLoaded`, full-object `persist()`, narrow-pane
auto-collapse; node collapse under the dedicated `wbsCollapsedNodes` key, panel collapse
under `wbsPanelCollapsed`; estimate/start/due/progress edits via `EstimatePromptModal` /
`DatePromptModal` / `ProgressPromptModal` (`ui/wbs/progress-modal.ts`), all writing numbers /
formatted dates through `frontmatter.service`; menu extras in the `kap-wbs` section incl.
**Save rolled-up estimate/progress** and **Distribute estimate to children**; standard
Set-status menu items work in the tree because `applyFilterAndRender` resolves
`this.columns` before the mode branches; the row's status dot is a button (#98) opening a
status-only quick menu — `buildStatusMenu`/`addStatusMenuItems` in `card-menu.ts`, shared
with the full card menu, wired `onStatusDot` → `WbsHost.showStatusMenu` → the view's
`cardMenuHost`, so both affordances use one `setCardStatus` write path; context rows keep a
plain span dot). Sibling order: planned starts first
(chronological), then the view's card sort; the panel sorts its status groups the same way.
Rows carry a due-countdown chip (`formatCountdown`, #62 tone ramp). **Incremental refresh:**
`renderWbs` keeps the shell; the panel re-renders only on a content-signature change and
tree rows reconcile via the board's pure `planReconcile` over `parentKey::path` instance
keys + row signatures (`data-wbs-key`/`data-wbs-sig`) — unchanged rows keep their DOM node,
so the post-write echo rebuild no-ops and scroll/focus/in-flight drags survive. DnD in
`ui/wbs/wbs-dnd.ts` (a `CalendarDnd` sibling: sources `.kap-wbs-row` + `.kap-wbs-pane-card`,
targets rows **and the panel** — a panel drop detaches the row from its context parent; live
`canDrop` validation rejects self/existing-parent/own-subtree/heuristic-detach with a red
highlight; rAF edge auto-scroll; linger-to-expand over collapsed branches; the drag source
re-resolves by key across mid-drag re-renders). Re-parenting/detaching resolve where the old
edge is physically stored via `directLinkTargets` (child-owned `parent` link, parent-owned
`children` link, or both — both sides are cleaned) and commit through
`addRelationshipLink`/`removeRelationshipLink`; the controller mutates the view's live
`relationshipsByPath` sets + card badge lists first and re-renders through a host
`refresh()` closure (`applyFilterAndRender`, NOT `rebuild()` — a rebuild would re-derive
from the not-yet-written frontmatter and snap back), so the echo rebuild re-derives
identical state (#64). Menu-time math (save-rollup, distribution, prefills) runs over the
unfiltered result set (`allCardForKey`). The progress property name is a global setting
(`defaultProgressProperty`, default `progress`), matching the timeline's global-property
decision.

**Configure-board modal** (`ui/configure-board-modal.ts`): a two-pane dialog — a left section nav
(Cards / Colors / Swimlanes / Relationships / Archiving) over a scrollable content pane; the
active section renders into `this.body`. The Archive-folder field uses `ui/folder-suggest.ts`
(`AbstractInputSuggest<TFolder>`) for inline folder autocomplete, preserving any `{{…}}`
placeholder suffix.

Relationships are layered in two pure modules + a bridge: `domain/relationships.ts`
(`resolveRelationships` — direct + inverse + heuristic) and `domain/filtering.ts` (blocked
filter) are unit-tested; `services/relationships.service.ts` reads tags/links from the metadata
cache and feeds the domain. **Editing (issue #14):** the card menu's **Relationships** submenu adds
/ removes **direct** links via `addRelationshipLink` / `removeRelationshipLink` / `directLinkTargets`
(string parsing/formatting in the pure, unit-tested `domain/wikilinks.ts`; a `FuzzySuggestModal`
note picker in `ui/relationship-target-modal.ts`). **Per-type resolution (mixed boards):**
`resolveBoardRelationships` takes a `noteTypeForPath` resolver — each file's role properties,
active roles (per-record `NoteRecord.activeRoles`), and heuristics (scoped via
`HeuristicRule.targetTypeId`) come from its own recognized type, falling back to the active type.
Writes use the owning card's own type's `roleProperties` (`relationshipPropertiesForPath`)
and the metadata-cache listener refreshes the board; inverse/heuristic relations stay read-only.
**Off-board blockers count; archived ones drop (issue #13):** direct links resolve against the whole vault, so a task
`blocked_by` a project on another board still shows blocked. `resolveBoardRelationships` then drops
any `blocked_by` target whose note lives under a configured archive folder — `domain/archive-paths.ts`
(`archiveFolderPrefix`/`isArchivedPath`, unit-tested) matches paths against each archive template's
static prefix (before the first `{{`), gathered across all note types. Navigational roles are not
archive-filtered. On the card,
`ui/board/card-renderer.ts` draws one counted badge per non-empty role (`onRelationship`
callback); the view resolves the badge to a single-note open or a picker `Menu`, honouring
Ctrl/Cmd for a new tab (`isNewTabEvent`).

**Live in-place refresh (issue #13).** Beyond `onDataUpdated` (which fires only when the Base
result set changes), the view registers `metadataCache.on('changed')` and rebuilds (debounced) when
a note **currently on the board** changes — so editing a `blocked_by` link, a due date, or a
displayed field updates the card without a reload even though the result set is unchanged.
