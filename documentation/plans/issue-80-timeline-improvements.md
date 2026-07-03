# Issue #80 — Timeline mode improvements

Builds on the issue #77 timeline. Requirements vs v1 state:

| Requirement                                  | State                                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| Bars from start+end dates                    | ✅ v1 (`barGeometry`)                                        |
| Mousewheel zoom in/out                       | ❌ new                                                       |
| Drag notes onto the timeline (schedule)      | ✅ v1 (chip drop)                                            |
| Drag notes off the timeline (unschedule)     | ❌ new                                                       |
| Extend/reduce duration by dragging bar edges | ❌ new (was v1 follow-up)                                    |
| Click card → open note                       | ✅ v1                                                        |
| Right-click card → set start/end date        | ❌ new                                                       |
| View duration (end − start)                  | ❌ new                                                       |
| Easy start/end for unscheduled notes         | partial (chip drag) → add menu                               |
| Add/remove milestones easily                 | ✅ v1 (dblclick track / right-click diamond) → add menu item |

The design below already incorporates a 3-lens adversarial critique (Obsidian API,
interaction edge cases, conventions) — the "critique:" notes mark the fixes it forced.

## Design

### 1. Bar resize handles (adjust start/end independently)

- Renderer: handle zones inside each bar (`kap-tl-handle kap-tl-handle-start` / `-end`,
  ~7px wide, `cursor: ew-resize`, visible on bar hover). A handle is **not** rendered: - on a clipped side (`clippedStart`/`clippedEnd`) — the real date is off-window; - **critique: when the bar renders narrower than 24px** (`widthPct / 100 ×
track.clientWidth < 24`) — otherwise two 7px zones swallow 1–3-day bars in
  quarter/year view and kill move-drag and click. Narrow bars fall back to the
  context menu (§4).
- Handle `pointerdown`: `preventDefault()` + `stopPropagation()` (no bar move-drag).
  Drag preview: convert the bar's %-geometry to px once, then live-set `left`/`width`
  in px with whole-day snapping (`dayWidth = track.clientWidth / totalDays`).
  **critique: clamp the preview delta to the same min-1-day rule as the commit**
  (width never < `dayWidth`) so preview and outcome agree; extending past the window
  edge is allowed (the commit allows off-window dates; next render clips).
  **critique: a delta-0 release is a click → `onOpen(card, ctrl/meta)`**, like the bar.
  On delta-0, restore the original % styles.
- Commit: `onResizeDates(card, edge: 'start' | 'end', dayDelta)`. The controller reads
  the real dates, computes `clampResizeDate(start, end, edge, dayDelta)` (pure domain:
  span never inverts, **minimum span = 1 day**, i.e. start ≤ end always;
  **critique: already-inverted stored dates are normalized first** — the effective
  span is the single `start` day, matching `barGeometry`), and writes only the dragged
  edge's property.
- Points (single-date cards) keep move-drag only; the missing date is set via §4.

### 2. Mousewheel zoom

- **Ctrl/Cmd + wheel** over the timeline steps through the range kinds
  (`week ↔ month ↔ quarter ↔ year`); plain wheel keeps scrolling the row body.
  `deltaY < 0` (wheel up) zooms in.
- Domain: `ZOOM_ORDER` + `zoomRange(kind, direction: 1 | -1): CalendarRange | null`
  (**critique: boundary/unknown results normalized with `?? null` — spec both ends**).
- Renderer stays DOM-only — **critique: callback is
  `onZoom(direction: 1 | -1, anchorPct: number | null)`**: the renderer maps `clientX`
  through the axis element's rect to a pct (**critique: `rect.width <= 0` → pass
  `null`**, same guard as dblclick/chip-drop — a NaN pct would poison the anchor);
  the controller computes the new anchor `window.start + dayOffsetAtPct(pct)`
  (null pct → keep the current anchor), applies `zoomRange`, persists via the existing
  `timelineRangeOverride`, rebuilds. `zoomRange` null → no-op (no persist, no rebuild).
- **critique: the `wheel` listener (`{ passive: false }`) attaches to the per-render
  `.kap-timeline` element created inside `renderTimeline`** — never to the passed-in
  `root` (that's the persistent `boardEl`; `root.empty()` does not remove its own
  listeners, so they'd stack per rebuild and leak into other modes).
- **critique: accumulate `deltaY` and step only when the running sum crosses ±50**,
  resetting after each step (trackpads emit dozens of fine events per gesture; without
  this one flick jumps week→year with a .base write + full rebuild per step).
- **critique: Ctrl-branch calls `preventDefault()` AND `stopPropagation()`** —
  Obsidian binds Ctrl+scroll to font/app zoom. Live-vault check: app zoom must not
  change while Ctrl+wheeling over the timeline. If Obsidian still wins (capture-phase
  handler), fall back to **Alt+wheel** — decision pre-made, don't improvise.
- **critique: while a bar/handle/chip drag is in progress the wheel handler no-ops**
  (module-level active-drag flag) — a mid-drag rebuild destroys the dragged element
  while the document-level pointer listeners survive and would commit a wrong date
  against stale geometry.

### 3. Drag off the timeline = unschedule

- Bar/point drag becomes 2D-aware. **critique: the click-vs-drag threshold becomes 2D
  (`Math.hypot(dx, dy) > 5`, matching `makeChipSchedulable`)** — the X-only `dx > 4`
  check would treat a straight-down drag as a click and open the note. X keeps the
  snapped-day preview; Y follows the pointer once over the footer.
- **critique: while a bar/point drag is in progress the footer gets `kap-tl-drop-ready`**
  (enlarged hit area + "Drop here to unschedule" hint, shown regardless of the
  collapsed/expanded state — collapsed it's otherwise a ~24px sliver); while the
  pointer is inside the footer rect it also gets `kap-tl-drop-remove` (highlight) and
  the dragged element `kap-tl-drag-remove`.
- Release inside the footer rect → `onUnschedule(card)` — **regardless of the X
  day-delta**. Otherwise the X day-delta commits as today.
- Controller `onUnschedule`: `deleteProperty` for whichever of start/end exist.
  **Milestones are kept** (the row survives if it has any). **critique: by default the
  start/end properties ARE the scheduled/due properties shared with board & calendar —
  unscheduling clears those everywhere; the menu item is labelled honestly
  ("Clear start & end dates") and the docs say so.**
- The undated footer always renders (even `Undated (0)`) so the drop target exists.

### 4. Timeline context menu (set dates, milestones, unschedule)

- `buildCardMenu(card, host, extend?)` gains an optional `extend(menu)` hook;
  `KanbanView.showCardMenu(card, event, extend?)` and `TimelineHost.showCardMenu`
  pass it through. Board/calendar/triage callers unchanged.
  **critique: every timeline item uses `.setSection('kap-timeline')`** — the menu
  already uses sections (`kap-schedule`, `kap-deadline`), so section-less items would
  sort into the implicit first section mid-menu, not at the end. No manual
  `addSeparator` (sections separate themselves). **critique: card-menu.spec.ts gains
  cases: extend items present with the section; menu without extend unchanged.**
- The extras (rows **and** undated chips):
    - **Set start date…** / **Set end date…** → `DatePromptModal`
      (**critique: pre-fill = `toDateKey(parsedDate)` or `''`** — the native date input
      silently rejects non-ISO strings); Set writes `formatDate(date, dateFormat)`,
      Clear deletes the property.
      **critique: skipped when the resolved timeline property equals the scheduled /
      deadline property** (host exposes `scheduledProperty()` / `deadlineProperty()`
      for the comparison) — the standard "Schedule on a date…" / "Set deadline on a
      date…" items already write exactly that property; duplicates would confuse.
    - **Add milestone…** → `MilestoneModal` (initial date: today).
    - **Clear start & end dates** (only when start or end exists) → same as §3.

### 5. Duration display

- Domain: `inclusiveDays(start, end)` (reversed spans → 1). **critique: `totalDays`
  delegates to it** so the inclusive-day convention has one source of truth.
- `TimelineRowModel.durationLabel: string | null` (`"12d"`, both dates only).
  **critique: the bar's text line becomes a flex row** — title truncates,
  duration `flex-none` muted at the end, both `pointer-events-none`; the duration span
  is skipped when the bar is narrow (< 60px rendered). Tooltip gains `— 12 days`
  (always, covers narrow bars).

## Structure (files touched)

- `src/app/domain/timeline.ts` + `timeline.spec.ts` — `ZOOM_ORDER`, `zoomRange`,
  `inclusiveDays` (+ `totalDays` delegation), `clampResizeDate` (+ specs incl.
  boundary nulls, reversed spans, inverted stored dates).
- `src/app/ui/timeline/timeline-renderer.ts` — handles (+ width gate), 2D drag +
  footer drop, wheel zoom (per-render element, accumulator, drag guard), duration
  span, always-on footer, new callbacks (`onResizeDates`, `onUnschedule`, `onZoom`).
- `src/app/views/kanban/timeline-controller.ts` — resize/unschedule/zoom handlers,
  context-menu extras, `durationLabel` in the row model.
- `src/app/views/kanban/card-menu.ts` + `card-menu.spec.ts` — optional `extend` param.
- `src/app/views/kanban/kanban-view.ts` — `showCardMenu` pass-through; host gains
  `scheduledProperty()` / `deadlineProperty()`.
- `src/styles.src.css` — handles, drop-ready/-remove states, duration span, footer
  hint (all under `.kap-root`, `kap-` prefix, `@layer kap-components`, Obsidian vars
  for color, Tailwind `@apply` for layout, no `!important`).
- Docs: `docs/usage.md` (timeline section), `README.md` (feature bullet),
  `documentation/Architecture.md`, `documentation/Business Rules.md`.

No new config keys; zoom reuses the range vocabulary, dates reuse the resolved
start/end properties.

## Invariants (→ Business Rules)

- Resizing clamps so start ≤ end (minimum span 1 day) and writes only the dragged
  edge's property; handles don't render on clipped sides or bars narrower than 24px.
- Unscheduling (footer drop or menu) deletes only the start/end properties —
  milestones are kept; by default those properties are the shared scheduled/due dates,
  so the card also leaves the calendar and loses its due badge.
- Wheel zoom requires Ctrl/Cmd (plain wheel scrolls); it steps one range kind per
  ±50 accumulated deltaY, anchors on the date under the cursor, persists like the
  range buttons, and is inert while a drag is in progress.
- **critique: rule 35's "out of scope" list must drop "bar resize handles"** and fold
  the #80 behaviors in (or become a rule 36) — otherwise rules contradict the code.

## Post-implementation review fixes

An adversarial 3-lens review of the diff confirmed and led to these fixes on top:

- `pointercancel` now **aborts** every drag (move / resize / chip) — cleanup +
  style restore, no callback; it previously routed to the committing `onUp`,
  where a canceled gesture's unreliable coordinates could write a wild date.
- Track width is measured **once per render** off the axis (`axis.clientWidth`)
  instead of per row (one reflow, not O(rows)), and `onResize` re-renders the
  timeline so the px width gates (handles, duration tag) re-evaluate on pane
  resize and hidden→visible leaves (which measure 0 while hidden).
- Inverted stored dates (end < start): dragging the **start** edge also rewrites
  the end to the old start day, so the pair can't stay inverted (the end edge
  already self-heals via the clamp).
- Docs accuracy: zoom "keeps the date under the cursor **in view**" (not "in
  place" — `periodRange` snaps to the containing period); unschedule of a
  milestone-bearing card keeps its row (milestone-only), it doesn't drop to
  Undated; README says Ctrl/Cmd+wheel.

## Live-vault validation (2026-07-03, temp fixtures, cleaned up after)

- Render: bar + `12d` badge, 2 handles, milestone diamond, start-only point,
  always-on `Undated (1)` footer. Screenshots taken; `dev:errors` clean.
- End handle +2d → `date_due` 2026-07-17 → 2026-07-19, start untouched.
- Start handle over-drag (+30d past end) → clamped exactly to the end date.
- Ctrl+wheel over the axis: Quarter → Month, **one** step per gesture, anchor
  July 2026 (cursor date); **Electron zoom factor unchanged** (0.694 before and
  after) — Ctrl/Cmd+wheel stays; the Alt+wheel fallback was not needed.
- Plain wheel: no zoom. Ctrl+wheel mid-drag: inert (`dragActive` guard).
- Point dragged onto the footer: `kap-tl-drop-ready`/`-remove` + hint engaged,
  `date_scheduled` deleted, undated count 1 → 2.
- Menu: "Add milestone…" + "Clear start & end dates" present, "Set start/end
  date…" correctly skipped (default scheduled/due properties); Clear via menu
  deleted both dates, kept the milestone list, row stayed as milestone-only.
- Bar move-drag +2d: both dates shifted, duration preserved.
- Chip drop at mid-track (July window) → `date_scheduled` 2026-07-16.

## Status

- [x] Plan + adversarial critique (31 findings folded in above)
- [x] Domain helpers + specs
- [x] Renderer / controller / wiring / CSS
- [x] Docs (usage, README, Architecture, Business Rules)
- [x] Post-review fixes (pointercancel abort, width-gate staleness, inverted
      dates, doc accuracy)
- [x] Gates: tsc, lint (0 warnings), 400 tests, build
- [x] Live-vault validation (incl. app-zoom non-interference check)
- [x] Committed and pushed
