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
services/          side-effectful adapters: frontmatter R/W, Starter Kit API, profiles, colors
domain/            pure, unit-tested logic: status, ordering, relationships, filtering, calendar, board model
settings/ + types/ plugin settings (Zod schema + defaults) and the settings tab
utils/             logging, date formatting, small DOM helpers
constants.ts       view type id, CSS scoping tokens, default property names
```

Rule of thumb: `domain/` is pure and tested with `bun test`; `services/`/`ui/` hold the
side effects and DOM, verified manually in Obsidian.

## Config flow

Three layers resolved by the (planned) profile service, in precedence order:
**per-view `this.config` → local profile/overrides → Starter Kit mirror → built-in defaults.**
When the Starter Kit plugin is present, its note-type config is the read-only source of
truth, mirrored into a local snapshot in plugin settings so it survives SK being disabled.

## Styling / isolation

Tailwind v4 is imported **without preflight** (theme + utilities layers only). All rendered
DOM lives under `.kap-root` and every class is `kap-`-prefixed (`constants.ts`); colors come
from Obsidian CSS variables. This keeps the plugin from clashing with core or other plugins.

## Current state

Milestone 0 (scaffolding): the view registers and mounts a placeholder; settings load/save
round-trip with Zod validation; domain config model + schemas exist. Board rendering,
drag/drop, profiles, relationships, and calendar mode are implemented in later milestones.
