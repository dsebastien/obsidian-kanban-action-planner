# Timeline rework — start + estimate model, usable undated strip, drop feedback

Owner feedback on the issue #80 timeline. Supersedes the start/end-date model from
issues #77/#80 (see `issue-80-timeline-improvements.md`). The design below already
incorporates a 3-lens adversarial critique (25 findings) — "critique:" notes mark the
forced fixes.

## Requirements (owner)

1. Undated strip entries become **fixed-size cards** (kanban-like), organized by
   **(1) note type, (2) status**; **all groups collapsed by default**.
2. Drag & drop feedback: the timeline **highlights** while dragging over it, and the
   **date that will be written is always visible** (guide + live label) — for drops
   AND while resizing/moving.
3. **No end date.** A **global "estimate" property** (default `estimate`, days) joins
   the start date (default: resolved scheduled property): start + estimate = span.
4. **Square** when no estimate, **rectangle spanning the estimate** when set.
5. Resize left edge → start date (bounded by the derived end, which stays anchored);
   right edge → estimate (bounded, never < 1).
6. Move drag → start date only.
7. Multi-type: rows grouped by type (collapsible) + per-type show/hide.

## Design

### 1. Data model: start + estimate

- Global setting `defaultEstimateProperty` (default `'estimate'`): zod schema +
  `DEFAULT_SETTINGS` + settings-tab text field. Old `data.json` → shallow-merge default.
- Per-view option `timelineEstimateProperty` **replaces** `timelineEndProperty`
  (existing `.base` files keeping the old key are simply ignored); fallback = global
  setting. `timelineStartProperty` unchanged.
- **critique: `parseEstimate(raw): number | null`** — number or numeric string;
  finite → `Math.ceil` (a half-day task spans a day) → result ≥ 1 else null. Spec
  0.4, 0.5, '2.6', 0, -1, 'abc', '', null, true, '3d'.
- **critique: estimates are written as NUMBERS** (`setProperty(app, file, prop, n)`),
  never formatted strings — a resize must not retype the property to text.
- Derived end = `start + estimate − 1` (inclusive). Duration badge = `"5d"`.
- **critique: overdue = estimate present AND derived end < today; squares are never
  overdue** (a past start date is normal in-progress work, not an error).
- Milestones, wheel zoom, range switcher, drag-off-to-unschedule stay. Unschedule
  clears **only the start date** (estimate = intrinsic effort, kept).
- Cards with estimate but no start are **undated**. **critique: migration note —
  end-only cards (due date, no scheduled) leave the tracks and become undated**, not
  squares; docs must say so.

### 2. Rendering

- Start + estimate → rectangle via `barGeometry(start, derivedEnd, window)`.
- Start only → **square** (`kap-tl-square`, ~12px, accent, centered on the day cell).
  Replaces `kap-tl-point`; row model: `square: { pct } | null`.
  **critique: remove the dead surface** — `TimelinePointModel`, `.kap-tl-point*` CSS,
  `groupByStatus` + `StatusGroup` (+ their spec blocks; superseded by
  `groupByTypeAndStatus`), and update the empty-state string ("…add a start date or
  an estimate", no more "start/end dates").
- Handles: rectangles ≥ 24px rendered width, non-clipped sides only (unchanged
  gating); squares get none (context menu instead).
- Row model additions: **critique: unclamped signed `startDayOffset: number`** (true
  start relative to the window start, may be negative when clipped) and
  `estimate: number | null` — needed so live labels are correct for clipped bars and
  off-window drags.

### 3. Live drag/resize feedback

- **critique: labels come from a controller closure in the callbacks,
  `labelForDayOffset(offset: number): string`** (`toDateKey(addDays(window.start,
offset))`) — works for ANY signed offset; no window-bounded `dayKeys` array
  (clipped bars/off-window drags would index `undefined`). The renderer stays
  DOM-only (closures are the established pattern).
- **critique: each gesture's label uses the same rounding as its commit path**:
  move/resize labels use `Math.round(dx / dayWidth)` (the commit's formula) applied
  to `startDayOffset`; chip-drop labels use the same pct→`dayOffsetAtPct` flooring
  as `onScheduleAt`.
- **Floating label** `kap-tl-drag-label`: **critique: appended to
  `ownerDocument.body` inside a `.kap-root`-classed wrapper** (CSS isolation holds),
  `position: fixed`, follows clientX/Y, removed in BOTH cleanup and pointercancel.
  Anything inside the bar/track/footer would be clipped (`overflow` on every
  ancestor) and break in popouts.
- **Guide line** `kap-tl-guide`: vertical line inside the hovered/dragged row's
  track (track is `relative`, full height) at the snapped day.
- Label content: move / left resize / chip drop → `→ 2026-07-14`; right resize →
  `5d → ends 2026-07-18`.
- **Chip drag**: **critique: `kap-tl-nohit` is applied once when the 5px threshold
  crosses and kept for the whole drag** (listeners live on `doc`); every pointermove
  does `doc.elementFromPoint(...)?.closest('.kap-tl-track')` to drive the body
  highlight (`kap-tl-drop-target`), guide, and label; pointerup reuses that test.
- **critique: the in-place transformed card is clipped by the footer's
  `overflow-y-auto`** — the dragged undated card instead renders a **fixed-position
  ghost** (card-styled, title text, in the same `.kap-root` wrapper as the label)
  following the pointer, while the original card dims in place.

### 4. Resize semantics (pure domain)

- **critique: `resizeFromStart(estimate, dayDelta): { startDelta: number; estimate:
number }`** — clamps the SHARED delta once (`d = Math.min(dayDelta, estimate − 1)`
  for positive deltas; negative = grow, unbounded) and derives both outputs from it,
  so the start can never pass the anchored end even if the raw delta overshoots.
  Spec: delta = estimate − 1, delta ≥ estimate, negative delta.
- `resizeEstimate(estimate, dayDelta): number` — `max(1, estimate + dayDelta)`.
- The renderer's live preview applies the identical clamp (mirroring `clampDelta`),
  so preview and commit agree.
- **critique: the left-handle commit writes start + estimate in ONE frontmatter
  transaction** — new `setProperties(app, file, record)` helper in
  `frontmatter.service.ts` (single `processFrontMatter` call); two sequential
  `setProperty` calls would double-rebuild and leave a torn intermediate state.
- Move commit: write start only (`start + dayDelta`). Remove `clampResizeDate`
  (+ specs).

### 5. Undated strip: uniform cards, type → status groups

- `kap-tl-undated-card`: fixed ~10rem × 3.5rem, 2-line clamped title, kanban-like
  border/background/hover/grab. Drag to schedule, click to open, right-click menu.
- Domain `groupByTypeAndStatus(items, typeOf, statusOf)`: types alphabetical with the
  no-type bucket last, statuses via `compareStatusValues` with no-status last.
- Multi-type boards: type header (`kap-tl-ugroup`) → status subgroups
  (`kap-tl-usubgroup`); single-type boards skip the type level. All collapsed by
  default; headers show counts.
- **critique (blocker): collapse state lives on the `TimelineController` instance**
  (like `undatedExpanded`) — a `Map<string, boolean>` keyed `typeId` /
  `typeId::status`, flowing into the view model as a resolved `collapsed` flag per
  group, toggled via `onToggleUndatedGroup(key)` / rebuild. Renderer-local or
  module-level state would reset on every frontmatter-write rebuild (expanding a
  group, dragging one card out, and watching everything snap shut) or leak across
  views.

### 6. Timeline row grouping + type visibility

- Host exposes **critique: `noteTypeFor(card): { id: string; name: string } | null`**
  (from `noteTypeByPath`; null = unrecognized). Unrecognized cards group under a
  fixed **"No type"** bucket with sentinel id `__none__` — never under the active
  type (its name is content-dependent and would misgroup/mis-hide them).
- Multi-type (>1 distinct type among the timeline's cards **before hiding**): rows
  grouped by type — collapsible `kap-tl-group` header rows (name + count, expanded
  by default, state on the controller instance), types alphabetical (No type last),
  the existing date sort applied **within** each group.
- **Types** toolbar button (checkable `Menu` of type names): **critique: built from
  the UNFILTERED type set and shown whenever that set has >1 entry** — hiding all
  types must not strand the user without the button. Hiding a type removes its rows
  AND its undated cards.
- **critique: hidden types persist by type ID** (rename-proof) in a dedicated config
  key `timelineHiddenTypes` with its own `restoreHiddenTypes()` /
  `persistHiddenTypes(ids)` host pair, validated as a string[] on read (reuse the
  `readIdArray`-style guard) — NOT folded into `TimelineViewState`, whose
  `persistState({ range })` call sites would silently clobber the list.

### 7. Context menu (timeline extras)

- **Set start date…** (unchanged; skipped when it equals the scheduled property).
- **Set estimate…** → new `EstimatePromptModal` (number input, days, min 1;
  Set / Clear / Cancel; Clear deletes the property). Replaces "Set end date…".
- **Add milestone…** (unchanged).
- **critique: "Clear start date"** (honest label — rule 35 requires the label to say
  what it clears; by default the start IS the shared scheduled date and the card also
  leaves the calendar; docs keep that disclosure). Shown only when a start exists.

### 8. Files touched

- `src/app/domain/timeline.ts` + spec — `parseEstimate`, `derivedEnd`,
  `resizeFromStart`, `resizeEstimate`, `groupByTypeAndStatus`; remove
  `clampResizeDate`, `groupByStatus`, `StatusGroup` (+ stale specs).
- `src/app/services/frontmatter.service.ts` (+ spec if feasible) — `setProperties`.
- `src/app/ui/timeline/timeline-renderer.ts` — squares, ghost + label + guide +
  body highlight, undated card grid + nested collapsible groups, type group rows,
  Types menu button, reworked callbacks (`labelForDayOffset`,
  `onToggleUndatedGroup`, `onToggleTypeGroup`, `onToggleTypeHidden`).
- `src/app/ui/timeline/estimate-modal.ts` (new) — modeled on `DatePromptModal`.
- `src/app/views/kanban/timeline-controller.ts` — estimate reads, grouping, hidden
  types, collapse maps, resize/unschedule/menu rework.
- `src/app/views/kanban/kanban-view.ts` — host wiring (`estimateProperty`,
  `noteTypeFor`, hidden-types persistence), drop end-property resolution.
- `src/app/views/kanban/kanban-view-options.ts` — end → estimate option swap.
- `src/app/types/plugin-settings.intf.ts` + `src/app/settings/settings-tab.ts` —
  `defaultEstimateProperty`.
- `src/styles.src.css` — squares, guide, label + ghost (body-level, `.kap-root`
  wrapper), drop highlight, undated cards (line-clamp), group headers.
- Docs — `docs/usage.md` (timeline rewrite + migration note),
  **critique: `docs/configuration.md` and `documentation/Configuration.md` property
  tables** (new global default), `README.md` bullet,
  `documentation/Architecture.md`, `documentation/Business Rules.md`.

## Invariants (→ Business Rules rule 35 rewrite)

**critique: rewrite rule 35 by replacing only the clauses that changed** (start/end →
start/estimate; unschedule; undated strip; grouping) and keep the still-true ones
verbatim: wheel-zoom semantics (Ctrl/Cmd, ±50 accumulator, cursor anchor, persisted,
inert mid-drag), handle gating (clipped sides, 24px), milestone format + gestures,
the 35% footer cap, row sort, "Set start date…" skipped for the scheduled property,
the shared-scheduled-property disclosure, and the out-of-scope list.

New clauses:

- Placement = start date + estimate (days, `parseEstimate`: ceil, ≥ 1); derived
  end = start + estimate − 1; no end-date property. Square (no estimate) vs
  rectangle; squares are never overdue; rectangles overdue when derived end < today.
- Left resize keeps the derived end anchored (shared-delta clamp, single
  frontmatter transaction writing start + estimate); right resize writes only the
  estimate (≥ 1); move/drop write only the start; "Clear start date" deletes only
  the start.
- Every drag/resize/drop shows the to-be-written date (or `Nd → ends <date>`) via a
  body-level floating label + in-track guide; drop targets highlight.
- Undated cards: uniform size, type → status groups, all collapsed by default,
  collapse state per controller instance (survives rebuilds, not persisted).
- Multi-type: rows grouped by type (No type bucket last), collapsible; hidden types
  persist by type ID in `timelineHiddenTypes`; the Types button derives from the
  pre-hiding type set.

## Owner follow-ups (implemented on top)

- **Calendar-parity layout:** the undated strip became a **collapsible left side
  panel** reusing the calendar's `kap-scheduling-panel` shell (`«`/`»` toggle,
  vertical title when collapsed, 36rem auto-collapse with manual precedence,
  collapse persisted per view as `timelinePanelCollapsed`; `TimelineViewState`
  gains `panelCollapsed`, the controller persists its full state so keys never
  clobber). The panel is the unschedule drop target (collapsed rail included).
- **"Unplanned" naming** (matching the calendar's tab): panel title, empty
  states, docs. Internal identifiers keep the `undated` vocabulary.
- **Drop feedback rework:** dragging a card from the panel accepts a drop
  **anywhere over the chart** (pct read off the axis geometry) and renders a
  striped, sticky **"New entry" lane** at the top of the row body — the drop
  visibly creates a new row instead of appearing to land on an existing card's
  line; the day guide renders inside the lane. The drag ghost's width is capped
  (`w-44`; in-panel cards are full-panel-width).

## Post-review fixes (adversarial verify, 9 + 3 confirmed)

Estimate-rework round: Types button also shown when any present type is hidden
(present set can shrink to one already-hidden type); a fully-clamped resize drag
is not a click (moved flag — no accidental note open); resize preview width
floored at 0 (clipped bars); docs — estimate row lists all three write paths,
left-edge bullet discloses the estimate write, rule 35 sort clause drops the
dead "end" fallback, option label "Estimate property (days)", "Clear estimate"
button label, migration note covers both-dates cards. Panel round: empty-state
copy no longer suggests an estimate creates a row; stale point-dot CSS comments.

## Live-vault validation (2026-07-03, temp multi-type fixtures, cleaned up)

- Render: rectangle (estimate span) + square (start-only) + milestone diamond;
  panel "Unplanned (2)"; two type groups; Types button; groups collapsed by
  default at both levels, expansion survives the rebuild each toggle triggers.
- Panel-card drag: striped "New entry" lane as sticky first child of the body,
  guide inside it, ghost 11rem, label `→ 2026-08-16` == the written start.
- Right resize +2: label `7d → ends 2026-07-12`, estimate written as NUMBER 7.
- Left resize +3: start +3d, estimate 7→4 — derived end anchored at Jul 12.
- Left over-drag (+30): clamped at the end (start = Jul 12, estimate = 1);
  preview label froze at the clamp — preview == commit.
- Drag onto the panel: drop-ready/-remove states; start deleted, estimate and
  milestones kept; the milestone-bearing card stayed as a milestone-only row.
- Menu: Set estimate… modal wrote number 4 → square became a rectangle live;
  Clear start date + Add milestone… present.
- Panel « toggle collapsed to the rail and `timelinePanelCollapsed` landed in
  the `.base`; `dev:errors` clean throughout.

## Status

- [x] Plan + adversarial critique (25 findings folded in above)
- [x] Implementation (src) + docs
- [x] Owner follow-ups (side panel, Unplanned naming, drop lane, ghost width)
- [x] Post-review fixes (12 confirmed findings)
- [x] Gates: tsc, lint (0 warnings), 405 tests, build
- [x] Live-vault validation
- [x] Committed and pushed
