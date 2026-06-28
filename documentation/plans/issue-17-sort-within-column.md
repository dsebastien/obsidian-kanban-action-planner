# Issue #17 — Sort cards within a column by a property

Let a board sort each column's cards by a chosen property (or name), in addition to the default
manual order. Per-view; reuses the calendar panel's pure sort helpers (`domain/calendar-tabs.ts`).

## Per-view options (Columns group, after "Manual order property")

| Key                 | Type     | Values / default                                  |
| ------------------- | -------- | ------------------------------------------------- |
| `cardSort`          | dropdown | `order` (default, = manual) / `name` / `property` |
| `cardSortProperty`  | property | used when `cardSort = property`                   |
| `cardSortDirection` | dropdown | `asc` (default) / `desc`                          |

Reuse the existing vocabulary (`order`/`name`/`property`) from `calendarTabSort` for consistency.

## Domain

- **`domain/calendar-tabs.ts`**: add a `direction: 'asc' | 'desc' = 'asc'` param to
  `compareTabCards`. Direction flips only the **value** comparison; nulls always sort **last** and
  the title tie-break stays ascending (stable, predictable). Existing 3-arg callers (calendar panel)
  are unchanged. Move `coerceSortValue` here from `calendar-controller.ts` (was private/untested),
  export + unit-test it; `calendar-controller` imports it.
- **`domain/board-model.ts`**: add `compare?: (a: T, b: T) => number` to `BuildBoardOptions`;
  `bucketColumns`/`singleLane`/`buildSingleLaneBoard` use it for the in-column sort, defaulting to
  the current manual `compareCards`. Domain stays generic — the view passes an opaque comparator.

## View (`kanban-view.ts`)

- Read `cardSort` / `cardSortDirection` / `cardSortProperty` (via `basesPropToName`) from `config`.
- Build a comparator over `KanbanCard`: map each card to a `TabSortKey`
  (`title = display.title`, `order`, `sortValue = coerceSortValue(frontmatter[sortProperty])`,
  `searchText = ''`) and return `compareTabCards(keyA, keyB, mode, direction)`. Pass it as
  `buildBoard(..., { compare })` — only when `cardSort !== 'order'` (manual keeps the existing path).
- **Disable manual reorder when a non-manual sort is active** (issue requirement): gate the
  order-write block in `applyMove` behind `cardSort === 'order'`, and early-return `reorderCard`
  (keyboard Alt+↑/↓). Cross-column drags / status changes still work; a within-column drop just
  doesn't write `manual_order` (it would be ignored by the property sort anyway).

## Acceptance

Choosing a sort key reorders every column's cards (both modes, both directions); switching back to
**Manual order** restores `manual_order` ordering and re-enables drag/keyboard reorder. Missing
values sort last. Default (no stored `cardSort`) behaves exactly as today.

## Docs

`docs/usage.md` (Moving/reordering + View options), `documentation/Business Rules.md` (new rule),
`documentation/Architecture.md` (board pipeline note).
