# Week Planner mode and one time tracker for every note type (issue #172)

Status: phase A (tracker rewrite) released as 1.24.0; phase B (time_blocks + Ideal week mode) implemented and committed locally (unreleased, Sébastien testing); phases C–E planned. Gate: each phase is decided with Sébastien and released on its own. The Obsidian Starter Kit side (schema, templates, backfill, Bases, docs, per-type config re-sync) shipped on 2026-09-09; the plugin reads and writes the properties below. Source of truth for the design: the OSK vault task note "Explore additional activity properties (Task)" (21 decisions + implementation amendments) and the spec comment on issue #172.

## Data model (already in the vault, units are the vault's: minutes, ISO datetimes, HH:MM)

Activities and projects: `time_blocks` (list of `<days> <start>-<end>` strings, 15-minute grid, `mon-fri` / `tue,thu` repeat, end < start crosses midnight), `minutes_per_week` (target, user), `minutes_planned_per_week` (plugin, sum of blocks), `minutes_alarm_per_week` (user), `time_entries` (TaskNotes shape `{startTime, endTime, description}`, never compacted), `time_spent` (own minutes, plugin), `total_time_spent` (persisted subtree roll-up, plugin), `date_last_session` (plugin). Projects also carry `date_committed`, `date_started`, `date_due`; their blocks apply between started and due. Goals and plans carry the tracking quartet (`time_entries`, `time_spent`, `total_time_spent`, `date_last_session`) but no blocks or budgets. Tasks carry `time_estimate`, `time_spent`, `time_entries`, `total_time_spent`. Daily notes carry `pomodoros` (TaskNotes object list; `pomodoroStorageLocation: daily-notes`).

Settings already re-synced in the vault: `defaultDurationProperty = time_spent`, `defaultTotalDurationProperty = total_time_spent`; goals / plans / projects calendar on with scheduled = `date_started`, due = `date_due`; parent → `related_goals`, siblings → the type's own `related_*`; Ideas type present. Done states and status → date stamping come from the OSK status mirror (`sk-stamp:*` rules, only-if-empty); do not add plugin-side stamping.

Decisions that bind the implementation: actuals are two numbers (own + persisted subtree) because actuals add while estimates are own-wins-else-derived; `cadence` is user-owned and never written; the week is an ideal week, no per-week overrides on periodic notes; colour and grouping come from the global `contexts` property, no category property; tasks stay out of the week grid (calendar / agenda modes keep them).

## Phase A: tracker rewrite (foundation) — DONE

Shipped: `domain/time-entries.ts`, `domain/pomodoro.ts`, `domain/daily-note.ts`, `services/time-tracking.service.ts` (rewrite), `services/daily-note.service.ts`, per-type `timeTracking` override (`Configure → Time tracking`), globals for entries / last session / pomodoro / daily-note fallback, status-bar readout with actions, commands `Start work pomodoro` / `Start pomodoro break` / `Stop pomodoro`, card-menu `Start / Stop pomodoro`, WBS `Recompute tracked time from entries`. Business rule 47. Not done (deferred, not needed by the vault): a `description` prompt on stop; auto-starting the next phase after a pomodoro (the notice names it; the status-bar menu starts it).

- Sessions write a `{startTime, endTime, description}` object to the note's `time_entries` (create the list when absent) on stop, instead of only adding minutes; `time_spent` = sum of the note's own entries (recompute from the list, do not accumulate blindly, so an edited entry is honoured); `date_last_session` = date of the latest entry. Property names per type through the existing per-type config, falling back to the global defaults (`defaultDurationProperty`, `defaultTotalDurationProperty`) plus new globals for entries and last session.
- The tracker works on any note type (it already does: one session at a time, epoch start persisted in settings); keep that.
- Pomodoro as a mode of the tracker: work / break durations from settings (defaults 25 / 5 / 15, long-break interval), writes the TaskNotes-shaped `pomodoros` record into the daily note (resolve the daily note through the Periodic Notes / Daily Notes core plugin API; fall back to asking for the folder + format in settings), and a work pomodoro on a note also opens a `time_entries` session on it (TaskNotes behaviour).
- WBS: `readDurationMinutes` reads `time_spent`; "Save total tracked time" writes `total_time_spent`; on a leaf `total_time_spent` may equal `time_spent`.
- Compatibility: notes carrying only a legacy `duration` number keep working (read it when `time_spent` and `time_entries` are both absent); nothing migrates data.
- Tests: entry append, recompute, midnight-crossing session, last-session date, pomodoro record shape, daily-note resolution.
- Docs: `docs/usage.md` Time tracking section, `docs/configuration.md` property table, README feature bullet.

## Phase B: time_blocks domain + Week Planner mode — DONE

Shipped: `domain/time-blocks.ts` + `domain/week-planner.ts` (pure, tested), `views/kanban/week-controller.ts`, `ui/week/week-renderer.ts` / `week-dnd.ts` / `week-note-picker.ts`, mode `week` (button “Ideal week”, command, `mode=ideal-week` / `mode=week`; date-less — Sébastien: an ideal week is shaped rarely, no week navigation; the rail lists every note and a missing weekly target is asked for on the first block; keyboard editing: arrows move, Shift+↑↓ resize, Delete removes; left/right edge drag stretches the repeat across days; marquee / Ctrl-click selection with Delete; Ctrl+C / Ctrl+V paste at the pointer; landing phantom on every drag; click creates in the cell the pointer is in; rail = Not planned yet / Planned, each by status), status roles mirrored from OSK 1.14 (`statusRoles`, `activeStatusValues`), Week planner settings (properties, grid hours, work band, block length, scale). Decided with Sébastien: one release; full-day grid with a configurable work band (09:00–17:00 mon-fri default); click-to-create through a type-aware picker AND drag from the rail; overlaps refused; 60-minute blocks snapped to 15; neutral grey without context. Business rule 48. Not done: per-type overrides of the three properties (globals only), keyboard editing of blocks.

- `domain/time-blocks.ts`: parse `<days> <start>-<end>` (day tokens `mon`..`sun`, lists, ranges, 15-minute grid, midnight crossing) into `{day 0..6, start, end}` slots and back; `plannedMinutesPerWeek(blocks)`; overlap detection across a set of notes' slots; validation errors that name the offending string.
- View mode `week` (in-view switch next to Board / Calendar / Timeline / Triage; embeddable with `mode=week`): a Monday-first grid (settings: start hour, end hour, 15-minute rows, `firstDayOfWeek` honoured) rendering every Active activity's blocks and every Active project's blocks whose `date_started`..`date_due` window includes the shown week; drag to move, drag edges to resize, alt-drag to copy, click to create; every edit rewrites the note's `time_blocks` through `setProperty` and recomputes `minutes_planned_per_week`; overlapping edits are refused with the conflicting note named.
- Colour by `contexts` (first context wins; palette from the existing colour tokens); a legend; a "Needs planning" rail for Active notes with a target and no blocks.
- Statuses resolved through the mirrored OSK status config (open values), never literals.
- Tests: parser round-trips, planned-minutes sums, overlap cases (same day, crossing midnight, range vs list), project date window filtering.

## Phase B follow-ups (fixed, part of 1.25.0)

Reported by Sébastien while testing the dev build with a real mouse; all three fixed and checked in the running vault:

1. **Left / right edge stretch**: the side zones were 6 px strips; now 10 px, and `week-dnd.ts` also treats a press within 10 px of a block's side edge as a stretch (`sideEdgeOf`, tested), so the handle element is only the visual affordance. Top / bottom handles are 8 px.
2. **00:00 label** was clipped (labels centre on their line; the first hung above the grid): the first label carries `kap-week-hour-first` and hangs below its line.
3. **Header / column drift**: the head row now lives inside the scroller as a sticky row, so it is laid out on the same width as the grid (the scrollbar narrows both).
4. **Optimistic UI** (owner rule, business rule 49): every edit renders at once from an in-memory overlay (`write()` sets it, then writes in the background; dropped when the vault echoes the same blocks, after a 10 s grace, or on a failed write) and `renderWeek` patches the existing DOM by piece key (`reconcilePieces`; rail / legend / errors rebuilt only when their content key changed; toolbar text updated in place), so the Base's echo neither flashes nor reflows the grid.
5. **Ctrl/Cmd-click opens the note in a new tab** (blocks and rail entries; a plain click opens it in place); selection toggling moved to Shift-click.
6. **Hover affordance thinned**: the resize zones stay 8 / 10 px wide for the mouse but paint only a 2 px line on their outer edge; the hover shadow is lighter.

## Phase C: budget ring + WBS roll-ups + lifecycle columns

Decided with Sébastien (2026-09-09): a ring with a short label; the alarm is visual plus ONE notice per note per ISO week; tracked-this-week = the note's own entries plus the entries of the tasks linked to it, both clipped to the ISO week (an entry crossing the week boundary counts only its minutes inside the week).

- Settings: a fourth week property, `defaultAlarmMinutesProperty` (default `minutes_alarm_per_week`), next to the three existing ones under Ideal week; the four get the per-type override block the plan deferred in phase B (same shape as `timeTracking` on the note type: blank = global).
- Domain (pure, tested): `clipEntryMinutes(entry, weekStart, weekEnd)` + `minutesInWeek(entries, week)` in `time-entries.ts`; `budgetRing({ target, planned, tracked, alarm })` → `{ ratio, tone: 'under' | 'on' | 'over' | 'alarm', label }` (label: `2h / 4h`, `4h` when no target); WBS roll-ups `effectiveTarget` / `effectivePlanned` ("own wins else children", mirror `createWbsRollups`) and `subtreeTrackedThisWeek` (adds, distinct descendant paths, like `subtreeDuration`); lifecycle days `cycleDays(done, started)`, `leadDays(started, committed)`, `latenessDays(done, due)`, `activeDays(today, started)` — null when a date is missing, never guessed.
- Linked tasks: tasks are not on every board, so the ring resolves them vault-wide through `metadataCache.resolvedLinks` (notes linking to the activity / project from a `related_*` frontmatter link, task type only), read once per render and cached by path; their `time_entries` come through the task type's tracking properties.
- Ring on activity and project cards (board mode) and in the WBS row: a conic-gradient ring driven by CSS custom properties (`--kap-ring-ratio`, tone class `kap-ring-<tone>`), short label inside the chip, full numbers in the tooltip (target / planned / tracked this week / alarm). Cards: the ring is part of the card signature (`signatures.ts`) so the reconciler refreshes it. WBS: one more fixed-width chip on EVERY row (context rows get the placeholder) and the fields join `rowSignature`.
- Alarm: tone `alarm` when tracked > alarm; the notice fires once per note per ISO week, remembered in settings as `weekAlarmNotified: Record<path, isoWeekKey>` (pruned when the week changes), saved with scope `none`.
- WBS columns cycle / lead / lateness for done items, days active for open ones; the done date is the property stamped by the mirrored done status rule (`sk-stamp:*` `set-property` action), falling back to the archive `doneDateProperties`; blank when unknown.
- Business rule 50 documents the ring semantics (target own-or-derived, planned own-or-derived, tracked adds, week = ISO week, alarm once per note per week).
- Tests: clipping (inside, crossing start, crossing end, open entry, wrong order), ring tones and labels, the two roll-ups on a small tree, lifecycle days with missing dates, alarm memo pruning.
- Docs: `docs/usage.md` Ideal week + WBS sections, `docs/configuration.md` property table, README bullet.

## Phase D: week-planner app import and export — IMPLEMENTED (branch `phase-d`)

Shipped on the branch: `domain/week-planner-io.ts` (+ spec, 12 tests: JSON / Markdown parsing, matching, round trips, rounding report), `ui/week/week-import-modal.ts` (paste or pick a file, replace / extend toggle), controller `importFromApp` / `runImport` / `askNoteFor` / `applyImport` / `exportToApp`, commands `import-ideal-week`, `export-ideal-week-json`, `export-ideal-week-markdown`, business rule 50 (numbered 51 once phase C's rule 50 merges first), docs. Limits: a note must carry the time blocks property to be an import target (the rail's notes); export covers the notes drawn on the grid.

- Import: the week-planner app's JSON (`WeekPlannerData { version, blocks[], config }`) and Markdown (`## Monday`..`## Sunday` with `- 09:00 - 10:30: Text` lines, `block_styles` frontmatter); match block text to Active activity / project names (exact, then case-insensitive, then ask); write `time_blocks`; 30-minute blocks map 1:1, unmatched text is reported, styling is dropped (contexts drive colour).
- Export: the reverse, from the current ideal week: JSON and Markdown in the app's formats, day ranges and lists expanded to one block per day, 15-minute slots rounded to the app's 30-minute grid with a warning listing what was rounded. Commands: "Export ideal week (JSON)", "Export ideal week (Markdown)", "Import ideal week".
- Tests: fixture round-trips on both formats, rounding report, name matching.

## Phase E: deep review of the old week-planner app (before closing the issue)

Read the week-planner app end to end (`$WKS/week-planner`: `src/types.ts`, `src/time-block-manager.ts`, `src/week-planner.ts`, its UI, templates, and export code) and list every feature the Ideal week mode does not have yet — templates / presets, block styling that matters beyond colour, multi-day spans, undo, printing, keyboard shortcuts, anything in its README. Decide each one with Sébastien (adopt, adapt, drop) and file the adopted ones as tasks; the plugin note and issue #172 get the resulting gap list.

`bun run format`, `bun run validate`, `bun run build`, live check in the vault (`bun run dev`, `obsidian dev:errors` clean), docs updated, commit with `bun run cm`, release through the shared plugin workflow, then re-check the OSK per-type config in the vault (`.obsidian/plugins/kanban-action-planner/data.json`) still matches the vault's properties and update the vault-side skills `osk-action-time-budget` / `osk-action-lifecycle` if a property name moved. Post a progress comment on issue #172 per phase.

## Phase F: user guide in Sébastien's voice

Once the feature set is stable, pass `docs/` (usage, configuration, README) through the ghostwriter with Sébastien's voice profile (`developassion-content-ghostwriter` + `osk-writing-humanizer`, `user-voice-profile`): same facts, his tone, no AI patterns; keep the structure and the screenshots.
