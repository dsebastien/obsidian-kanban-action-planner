# Issue #19 — Persist calendar & lane view state across reloads

Calendar + swimlane/column UI state is in-memory and resets on every reload. Persist the
**durable** bits per-view to `this.config` (the same flat-key mechanism `filterQuery` and
`calendarMode` already use — undeclared keys are allowed, no options schema change). Keep
**transient** bits in-memory.

## What persists (per-view `this.config`)

| Key                      | Type                                       | Source                | Default on missing                                             |
| ------------------------ | ------------------------------------------ | --------------------- | -------------------------------------------------------------- |
| `calendarRangeOverride`  | `'week'\|'month'\|'quarter'\|'year'\|null` | toolbar range buttons | `null` (→ falls back to the configured `calendarRange` option) |
| `calendarTab`            | `'scheduled'\|'deadline'`                  | panel tab switch      | `'scheduled'`                                                  |
| `calendarPanelCollapsed` | `boolean`                                  | panel collapse toggle | `false`                                                        |
| `calendarShowScheduled`  | `boolean`                                  | legend toggle         | `true`                                                         |
| `calendarShowDeadlines`  | `boolean`                                  | legend toggle         | `true`                                                         |
| `collapsedLanes`         | `string[]`                                 | lane collapse         | `[]`                                                           |
| `collapsedColumns`       | `string[]`                                 | column collapse       | `[]`                                                           |

## What stays transient (reset on reload, per the issue)

- Calendar **anchor** date (resets to today).
- Calendar **focused day** (zoom) — resets to none.
- `panelAutoCollapsed` / `panelLastNarrow` — pure auto-collapse runtime mechanics.

## Implementation

**`view-config.ts`** — add `readIdArray(value): string[]` (accepts only a string[]; unlike
`readStringArray` it does NOT split on commas, so ids containing commas survive). Unit-test it.

**`calendar-controller.ts`** — controller stays config-agnostic; persistence flows through the host.

- Add a `CalendarViewState` shape `{ range, tab, panelCollapsed, showScheduled, showDeadlines }`.
- `CalendarHost`: add `restoreState(): CalendarViewState` and `persistState(s: CalendarViewState): void`.
- Add `private loaded = false` + `ensureLoaded()` that loads durable fields from `host.restoreState()`
  once (config is unavailable at construction — load lazily, like the view's `loadFilterQuery`).
  Call `ensureLoaded()` at the top of `render()` and `evaluatePanelAutoCollapse()`.
- Add `private persist()` → `host.persistState({...current durable fields})`. Call it in the
  callbacks that change a durable field: `onSetRange`, `onSwitchTab`, `onToggleDimension`,
  `onTogglePanel`, and in `evaluatePanelAutoCollapse` after it flips `panelCollapsed`.

**`kanban-view.ts`**

- Implement the two host closures: `restoreState` reads the five calendar keys (defaults above);
  `persistState` writes them via `this.config.set`.
- Lazy-load lanes/columns: add `collapseInitialized` + `loadCollapseState()` (clears then fills
  `collapsedLanes`/`collapsedColumns` from `readIdArray(config.get(...))`), called once in `rebuild()`
  before the render (mirror `loadFilterQuery`). Persist in `toggleLane`/`toggleColumn` via
  `config.set(key, [...set])`.

## Acceptance

Set a range / switch the tab / toggle a legend / collapse the panel / collapse a lane or column →
reload the view (`plugin:reload` + reopen, or detach+reopen the Bases leaf) → each is preserved.
Anchor + focused-day reset to today/none. A view with no stored keys behaves exactly as today.

## Docs

- `docs/` usage guide: note that calendar range/tab/legend/panel + collapsed lanes/columns now
  stick per view; anchor/zoom reset on reload.
- `documentation/Business Rules.md`: add a rule for per-view persisted UI state (extends #10/#16/#34
  per-view-config precedent).
- `documentation/Architecture.md`: extend the calendar/collapse notes to say the durable bits persist.
