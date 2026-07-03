# Issue #77 — Timeline view

Gantt-like fourth view mode (Board / Calendar / Triage / **Timeline**): one row per card,
a horizontal bar spanning its start → end dates on a shared time axis, milestone diamonds
from a configurable list property.

## Decisions (v1)

- **Fourth view mode.** `timeline` joins `ViewMode`; persisted via a `timelineMode` config
  key exactly like `calendarMode`/`triageMode`. Toolbar gets a **Timeline** button and a
  `toggle-timeline-mode` command.
- **Configurable date properties, per view.** `timelineStartProperty` / `timelineEndProperty`
  (Bases property options, `note.*` only — drag writes them). Defaults: the resolved
  scheduled / due date properties, so a board that already uses calendar mode gets a
  working timeline with zero config.
- **Milestones from a configurable list property.** `timelineMilestoneProperty` (default
  `milestones`). Each list entry is `"<date> [label…]"` (wikilink brackets tolerated,
  date parsed with the same `parseFrontmatterDate` as everything else); non-parseable
  entries are skipped (best-effort, never throws). Rendered as diamond markers on the
  card's row with a tooltip.
- **Axis = the calendar vocabulary.** Range: week / month / quarter / year (per-view
  `timelineRange` default + persisted `timelineRangeOverride`, mirroring
  `calendarRangeOverride`); anchor is transient (resets to today) with ‹ / Today / ›
  navigation reusing `shiftAnchor` / `periodRange`. Today line on every track.
- **Degrade gracefully.** Both dates → bar (clipped at the range edges with a visual cue);
  one date → a point dot; milestones only → diamonds only. Cards with no dates at all
  collect in a collapsible **Undated** footer strip (chips, click to open).
- **Drag to reschedule.** Dragging a bar/point horizontally shifts its date(s) by the
  snapped day delta and writes the start/end properties (momentjs format, same write path
  as calendar DnD). No resize handles in v1 (follow-up). Milestones are not draggable.
- **Rows** sorted by start (then end, then milestone date, then title); the toolbar filter
  and the #74 zoom apply as everywhere (the timeline renders the already-filtered cards).
- **Row content**: title (click to open, right-click for the card context menu), bar
  colored via accent; overdue wash when the end date is past.

## Structure

- `src/app/domain/timeline.ts` (+ spec): pure — milestone parsing (`parseMilestones`),
  bar/point geometry in % of the range (`barGeometry`, `pointPct`, inclusive-day math),
  axis ticks per range kind (`axisTicks`), day delta (`daysBetween`).
- `src/app/ui/timeline/timeline-renderer.ts`: DOM (header, axis, rows, undated strip)
    - pointer-drag rescheduling.
- `src/app/views/kanban/timeline-controller.ts`: state (range override, anchor), row
  building from frontmatter, date writes; mirrors `CalendarController`.
- Wiring: `kanban-view.ts` (mode, render branch, options read), `view-toolbar.ts`,
  `kanban-view-options.ts` (Timeline group), `plugin.ts` (command), `styles.src.css`.

## Out of scope (follow-ups)

- Bar resize handles (change start/end independently by drag).
- Dependency arrows (`blocked_by`) between bars.
- Hierarchy indentation (overlaps WBS view, #76).
- Aggregated milestone lane on the axis; milestone notes as first-class milestones.

## Owner follow-ups (implemented)

- **Undated strip grouped by status** (`groupByStatus`, column order, no-status last).
- **Scrolling**: row body scrolls vertically (verified with 30 rows); the undated strip caps at
  35% height and scrolls its own content so it can't squeeze out the rows.
- **Schedule from the timeline**: drag an undated chip onto any track → writes the start date
  property for the day under the pointer (`dayOffsetAtPct`).
- **Define milestones**: double-click a row's track → `MilestoneModal` (date pre-filled,
  optional label) → appends `<date> <label>` to the milestone list property
  (`appendToListProperty`); right-click a diamond → remove entry (`removeFromListProperty`,
  property deleted when the list empties; removal keyed by the raw list entry).

## Status

- [x] Plan
- [x] Domain helpers + specs (day math, milestone parsing incl. raw, geometry, ticks,
      `dayOffsetAtPct`, `groupByStatus`)
- [x] Renderer + controller (incl. chip drag-to-schedule, milestone create/remove)
- [x] View wiring, options, command, CSS
- [x] Docs (usage, READMEs, Business Rules rule 35)
- [x] Live-vault validation (render, clipping, overdue, milestones incl. create at 25% →
      2026-07-08 + label + removal, chip drop at 50% → 2026-07-16, scroll with 30 rows,
      drag +2d write, range switch, filter integration, persistence)
- [ ] Awaiting review — implemented but **not committed** per owner instruction
