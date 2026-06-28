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
  over a per-card `CardSearchRecord`). The view builds one `CardSearchRecord` per card from the
  metadata cache (lowercased title, relationship names, tags, all frontmatter values, status
  value+label, parsed due date) so keystroke matching does no file reads. `rebuild()` derives
  the unfiltered `allCards` + records once; `applyFilterAndRender()` filters and renders, and is
  also called directly (debounced ~150 ms) on a filter keystroke — so typing re-renders without
  re-deriving cards/relationships. The filter input is a **persistent** toolbar element
  (`ui/filter-bar.ts`) in its own slot between the re-rendered mode-switch (left) and actions
  (right) slots, so it never loses focus. The query persists per-view in `config.filterQuery`;
  it applies in both board and calendar mode and replaced the old `calendarFilter` option.
- **Live config propagation.** The plugin tracks open views in a `Set` (`trackKanbanView` /
  `untrackKanbanView`, wired in the view's load/unload). `saveSettings()` — the single sink for
  every profile/settings write — calls `view.onSettingsChanged()` (debounced rebuild) on each,
  so a card-field edit from the right-click "Show fields" menu **or** the settings tab refreshes
  every open board immediately. Card display is resolved **per note type** (`cardPresentationFor`
  → the file's note-type profile, else the active profile), so a mixed board shows each type's
  own fields.

## Layering (target)

```
views/kanban/      Bases view + its options panel (thin; delegates to ui + domain)
ui/                vanilla-DOM renderers: board, calendar, view toolbar, gear, folder suggest, modal (no UI deps)
services/          side-effectful adapters: frontmatter R/W, Starter Kit API, profiles, colors, archive
domain/            pure, unit-tested logic: status, ordering, relationships, filtering, calendar, board model
settings/ + types/ plugin settings (Zod schema + defaults) and the settings tab
utils/             logging, date formatting, placeholder expressions, small DOM helpers
constants.ts       view type id, CSS scoping tokens, default property names
```

Rule of thumb: `domain/` is pure and tested with `bun test`; `services/`/`ui/` hold the
side effects and DOM, verified manually in Obsidian.

## Config flow

Three layers resolved by the (planned) profile service, in precedence order:
**per-view `this.config` → local profile/overrides → Starter Kit mirror → built-in defaults.**
When the Starter Kit plugin is present, its note-type config is the read-only source of
truth, mirrored into a local snapshot in plugin settings so it survives SK being disabled.

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
**profiles** (mirrored from the Obsidian Starter Kit when present), a **color** system applied
to cards/columns, **config-driven card presentation** (title/fields/cover/wrap), **configurable
swimlanes** (group by note type or a property, with collapsible lanes and an Ungrouped lane;
cross-lane drag rewrites the grouping property), **relationships** (parent/sibling/child/
blocked_by detection with inverse lookup + a tag+link heuristic, blocked-by flag/navigation, and
a blocked filter), per-view options, a tabbed Configure-board modal, and global settings.
**Archiving** (folder with placeholders + optional auto-archive on status) and **calendar mode**
(scheduling panel + grid, deadline highlighting, responsive auto-collapse) are also implemented.

The board pipeline: `domain/board-model.ts` `buildBoard()` is pure and unit-tested (buckets
cards into `BoardLane[] → BoardColumn[]`, `isMultiLane` flag); `ui/board/board-renderer.ts`
renders chrome-free for a single lane or collapsible `.kap-lane` swimlanes otherwise;
`ui/board/dnd-controller.ts` reports `{ laneId, columnId, index }` drop targets; the view
(`views/kanban/kanban-view.ts`) resolves grouping + per-file lane values, computes relationships,
applies the blocked filter, and persists status/order/grouping-property writes via
`services/frontmatter.service.ts`.

**Incremental refresh (M6).** The view calls `patchBoard()` (not a full re-render) on every
update. When the lane/column **shape** is unchanged (a `data-board-struct` signature on the
host matches), each column's card list is reconciled by the pure, unit-tested
`ui/board/reconcile.ts` `planReconcile()` over `data-card-key` + a content `data-card-sig`:
unchanged cards keep their exact DOM node (so scroll, focus, and an in-flight drag survive),
only changed/new cards are rebuilt, gone cards removed, and order is fixed with a React-style
cursor. Shape changes (config edits, a new status column, calendar↔board switch, the empty
state) fall back to a full `renderBoard()`. Lane collapse/counts are synced in place. **Sizing
invariants:** every column is a fixed equal width; cards are a single uniform height board-wide,
computed at runtime by `ui/board/card-equalize.ts` `applyUniformCardHeight()` as the tallest
card's natural height (published as the `--kap-card-height` CSS var, applied as `min-height`;
re-run after every `patchBoard` and on resize). Cards never shrink below their content
(`flex: none`) so nothing is clipped — the column body scrolls instead; sparser cards get
matching whitespace. The pure max-picking helper `uniformCardHeight()` is unit-tested.

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
the board: `ui/calendar/calendar-renderer.ts` draws a collapsible **Scheduling** panel plus a
CSS-grid calendar (`grid-template-columns: repeat(7, minmax(0, 1fr))` so every day stays visible
and chips truncate). **Unified overlay:** the grid plots every card on **both** its scheduled day
_and_ its deadline — `cardsByDay` is a `Map<dayKey, CalendarEntry[]>` where each entry carries a
`kind` (`scheduled` blue / `deadline` orange / `both` split-edge when same day) and an `overdue`
flag (deadline before today → red). A card with two dates appears twice. The panel's two tabs are
now just **backlogs** (cards missing each date) and decide which date a _panel drag_ sets; a
toolbar **legend** doubles as a per-dimension filter (`showScheduled`/`showDeadlines`). DnD:
`ui/calendar/calendar-dnd.ts` reads the dragged chip's `data-dimension` and reports it, so
dragging a chip moves _its own_ date (`both` moves both); dropping on the panel clears it.
Scheduling is also reachable from the **card right-click menu** (Schedule / Set deadline →
today / tomorrow / pick-a-date via `ui/date-prompt-modal.ts` / clear), on the board too. A
`ResizeObserver` on the board host **auto-collapses the panel** when the container is narrower
than ~36rem and restores it when there's room (only on a width-category change; a manual toggle
clears the auto state). In-memory per-session calendar state: range override, active tab, anchor,
focused day, panel-collapsed (+ auto-collapse flags), and the two legend toggles.

**Configure-board modal** (`ui/configure-board-modal.ts`): a two-pane dialog — a left section nav
(Cards / Colors / Swimlanes / Relationships / Archiving) over a scrollable content pane; the
active section renders into `this.body`. The Archive-folder field uses `ui/folder-suggest.ts`
(`AbstractInputSuggest<TFolder>`) for inline folder autocomplete, preserving any `{{…}}`
placeholder suffix.

Relationships are layered in two pure modules + a bridge: `domain/relationships.ts`
(`resolveRelationships` — direct + inverse + heuristic) and `domain/filtering.ts` (blocked
filter) are unit-tested; `services/relationships.service.ts` reads tags/links from the metadata
cache and feeds the domain. Relationships are read-only (never written back). On the card,
`ui/board/card-renderer.ts` draws one counted badge per non-empty role (`onRelationship`
callback); the view resolves the badge to a single-note open or a picker `Menu`, honouring
Ctrl/Cmd for a new tab (`isNewTabEvent`).
