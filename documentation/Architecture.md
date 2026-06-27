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

## Layering (target)

```
views/kanban/      Bases view + its options panel (thin; delegates to ui + domain)
ui/                vanilla-DOM renderers: board, calendar, context menu, modal (no UI deps)
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
a blocked filter), per-view options, a Configure-board modal, and global settings. Archiving and
calendar mode are implemented in later milestones.

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
invariants:** every column is a fixed equal width; cards share a `min-height` floor with growth
bounded by field truncation (or a 4-line clamp in wrap mode) — uniform width + capped height
rather than a single forced height (which would hide content).

Relationships are layered in two pure modules + a bridge: `domain/relationships.ts`
(`resolveRelationships` — direct + inverse + heuristic) and `domain/filtering.ts` (blocked
filter) are unit-tested; `services/relationships.service.ts` reads tags/links from the metadata
cache and feeds the domain. Relationships are read-only (never written back). On the card,
`ui/board/card-renderer.ts` draws one counted badge per non-empty role (`onRelationship`
callback); the view resolves the badge to a single-note open or a picker `Menu`, honouring
Ctrl/Cmd for a new tab (`isNewTabEvent`).
