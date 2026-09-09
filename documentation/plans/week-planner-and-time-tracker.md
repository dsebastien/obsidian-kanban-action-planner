# Week Planner mode and one time tracker for every note type (issue #172)

Status: planned, nothing implemented. The Obsidian Starter Kit side (schema, templates, backfill, Bases, docs, per-type config re-sync) shipped on 2026-09-09; the plugin reads and writes the properties below. Source of truth for the design: the OSK vault task note "Explore additional activity properties (Task)" (21 decisions + implementation amendments) and the spec comment on issue #172.

## Data model (already in the vault, units are the vault's: minutes, ISO datetimes, HH:MM)

Activities and projects: `time_blocks` (list of `<days> <start>-<end>` strings, 15-minute grid, `mon-fri` / `tue,thu` repeat, end < start crosses midnight), `minutes_per_week` (target, user), `minutes_planned_per_week` (plugin, sum of blocks), `minutes_alarm_per_week` (user), `time_entries` (TaskNotes shape `{startTime, endTime, description}`, never compacted), `time_spent` (own minutes, plugin), `total_time_spent` (persisted subtree roll-up, plugin), `date_last_session` (plugin). Projects also carry `date_committed`, `date_started`, `date_due`; their blocks apply between started and due. Goals and plans carry the tracking quartet (`time_entries`, `time_spent`, `total_time_spent`, `date_last_session`) but no blocks or budgets. Tasks carry `time_estimate`, `time_spent`, `time_entries`, `total_time_spent`. Daily notes carry `pomodoros` (TaskNotes object list; `pomodoroStorageLocation: daily-notes`).

Settings already re-synced in the vault: `defaultDurationProperty = time_spent`, `defaultTotalDurationProperty = total_time_spent`; goals / plans / projects calendar on with scheduled = `date_started`, due = `date_due`; parent → `related_goals`, siblings → the type's own `related_*`; Ideas type present. Done states and status → date stamping come from the OSK status mirror (`sk-stamp:*` rules, only-if-empty); do not add plugin-side stamping.

Decisions that bind the implementation: actuals are two numbers (own + persisted subtree) because actuals add while estimates are own-wins-else-derived; `cadence` is user-owned and never written; the week is an ideal week, no per-week overrides on periodic notes; colour and grouping come from the global `contexts` property, no category property; tasks stay out of the week grid (calendar / agenda modes keep them).

## Phase A: tracker rewrite (foundation)

- Sessions write a `{startTime, endTime, description}` object to the note's `time_entries` (create the list when absent) on stop, instead of only adding minutes; `time_spent` = sum of the note's own entries (recompute from the list, do not accumulate blindly, so an edited entry is honoured); `date_last_session` = date of the latest entry. Property names per type through the existing per-type config, falling back to the global defaults (`defaultDurationProperty`, `defaultTotalDurationProperty`) plus new globals for entries and last session.
- The tracker works on any note type (it already does: one session at a time, epoch start persisted in settings); keep that.
- Pomodoro as a mode of the tracker: work / break durations from settings (defaults 25 / 5 / 15, long-break interval), writes the TaskNotes-shaped `pomodoros` record into the daily note (resolve the daily note through the Periodic Notes / Daily Notes core plugin API; fall back to asking for the folder + format in settings), and a work pomodoro on a note also opens a `time_entries` session on it (TaskNotes behaviour).
- WBS: `readDurationMinutes` reads `time_spent`; "Save total tracked time" writes `total_time_spent`; on a leaf `total_time_spent` may equal `time_spent`.
- Compatibility: notes carrying only a legacy `duration` number keep working (read it when `time_spent` and `time_entries` are both absent); nothing migrates data.
- Tests: entry append, recompute, midnight-crossing session, last-session date, pomodoro record shape, daily-note resolution.
- Docs: `docs/usage.md` Time tracking section, `docs/configuration.md` property table, README feature bullet.

## Phase B: time_blocks domain + Week Planner mode

- `domain/time-blocks.ts`: parse `<days> <start>-<end>` (day tokens `mon`..`sun`, lists, ranges, 15-minute grid, midnight crossing) into `{day 0..6, start, end}` slots and back; `plannedMinutesPerWeek(blocks)`; overlap detection across a set of notes' slots; validation errors that name the offending string.
- View mode `week` (in-view switch next to Board / Calendar / Timeline / Triage; embeddable with `mode=week`): a Monday-first grid (settings: start hour, end hour, 15-minute rows, `firstDayOfWeek` honoured) rendering every Active activity's blocks and every Active project's blocks whose `date_started`..`date_due` window includes the shown week; drag to move, drag edges to resize, alt-drag to copy, click to create; every edit rewrites the note's `time_blocks` through `setProperty` and recomputes `minutes_planned_per_week`; overlapping edits are refused with the conflicting note named.
- Colour by `contexts` (first context wins; palette from the existing colour tokens); a legend; a "Needs planning" rail for Active notes with a target and no blocks.
- Statuses resolved through the mirrored OSK status config (open values), never literals.
- Tests: parser round-trips, planned-minutes sums, overlap cases (same day, crossing midnight, range vs list), project date window filtering.

## Phase C: budget ring + WBS roll-ups + lifecycle columns

- Budget ring on activity and project cards and in the WBS row: target (`minutes_per_week`) vs planned vs tracked this ISO week (own entries plus linked tasks' entries clipped to the week); alarm state when tracked > `minutes_alarm_per_week`.
- WBS: roll target / planned / tracked-this-week up to goals and plans (display only, never persisted, same "own value wins else children" model as estimates for target and planned; tracked adds).
- WBS columns cycle (done date − `date_started`), lead (`date_started` − `date_committed`), lateness (done date − `date_due`) for done items; days active for open ones. Done dates come from the mirrored status config.
- Tests: ring math per week, roll-up model, column math with missing dates (blank, never guessed).

## Phase D: week-planner app import and export

- Import: the week-planner app's JSON (`WeekPlannerData { version, blocks[], config }`) and Markdown (`## Monday`..`## Sunday` with `- 09:00 - 10:30: Text` lines, `block_styles` frontmatter); match block text to Active activity / project names (exact, then case-insensitive, then ask); write `time_blocks`; 30-minute blocks map 1:1, unmatched text is reported, styling is dropped (contexts drive colour).
- Export: the reverse, from the current ideal week: JSON and Markdown in the app's formats, day ranges and lists expanded to one block per day, 15-minute slots rounded to the app's 30-minute grid with a warning listing what was rounded. Commands: "Export ideal week (JSON)", "Export ideal week (Markdown)", "Import ideal week".
- Tests: fixture round-trips on both formats, rounding report, name matching.

## After each phase

`bun run format`, `bun run validate`, `bun run build`, live check in the vault (`bun run dev`, `obsidian dev:errors` clean), docs updated, commit with `bun run cm`, release through the shared plugin workflow, then re-check the OSK per-type config in the vault (`.obsidian/plugins/kanban-action-planner/data.json`) still matches the vault's properties and update the vault-side skills `osk-action-time-budget` / `osk-action-lifecycle` if a property name moved. Post a progress comment on issue #172 per phase.
