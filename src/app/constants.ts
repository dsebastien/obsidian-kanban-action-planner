/**
 * Plugin-wide constants.
 *
 * The view type id is the stable identifier Bases uses to persist which view a
 * `.base` file is using; never change it after release.
 */

/** Bases view type id. Must stay stable across releases. */
export const KANBAN_VIEW_TYPE = 'kanban-action-planner'

/** Lucide icon shown in the Bases view picker. */
export const KANBAN_VIEW_ICON = 'kanban-square'

/** Human-readable view name shown in the Bases view picker. */
export const KANBAN_VIEW_NAME = 'Kanban'

/**
 * CSS scoping. Every DOM node the plugin renders lives under `.kap-root`, and
 * every class is prefixed with `kap-`, so the plugin's styles never leak into
 * (or get clobbered by) Obsidian core or other plugins.
 */
export const CSS_ROOT_CLASS = 'kap-root'

/** Default frontmatter property names (configurable in settings / per view). */
export const DEFAULT_STATUS_PROPERTY = 'status'
export const DEFAULT_ORDER_PROPERTY = 'manual_order'
export const DEFAULT_BLOCKED_BY_PROPERTY = 'blocked_by'
export const DEFAULT_SCHEDULED_DATE_PROPERTY = 'date_scheduled'
export const DEFAULT_DUE_DATE_PROPERTY = 'date_due'
/** Default defer ("can't start until") date property (issue #113). */
export const DEFAULT_DEFER_DATE_PROPERTY = 'date_defer'
/** Days a note is expected to take (drives the timeline's bar length). */
export const DEFAULT_ESTIMATE_PROPERTY = 'estimate'
/** Minutes one work day represents (minute-estimate → days conversion). */
export const DEFAULT_MINUTES_PER_DAY = 480
/** Milestone list entries (`<date> [label]`) rendered as timeline diamonds. */
export const DEFAULT_MILESTONES_PROPERTY = 'milestones'
/** Completion percentage 0–100 (drives the WBS progress bars; issue #76). */
export const DEFAULT_PROGRESS_PROPERTY = 'progress'
/** Tracked time in minutes, accumulated by start/stop sessions (issue #119). */
export const DEFAULT_DURATION_PROPERTY = 'duration'
/** Persisted subtree tracked-time rollup in minutes (issue #119). */
export const DEFAULT_TOTAL_DURATION_PROPERTY = 'total_duration'
/**
 * TaskNotes-compatible tracking (issue #172): the entries ledger and the
 * last-session date. Defaults are TaskNotes' mapped names.
 */
export const DEFAULT_TIME_ENTRIES_PROPERTY = 'time_entries'
export const DEFAULT_LAST_SESSION_PROPERTY = 'date_last_session'
/** Daily-note list property holding pomodoro records (TaskNotes' name). */
export const DEFAULT_POMODOROS_PROPERTY = 'pomodoros'
/** Pomodoro durations (minutes) and long-break cadence (TaskNotes' defaults). */
export const DEFAULT_POMODORO_WORK_MINUTES = 25
export const DEFAULT_POMODORO_SHORT_BREAK_MINUTES = 5
export const DEFAULT_POMODORO_LONG_BREAK_MINUTES = 15
export const DEFAULT_POMODORO_LONG_BREAK_INTERVAL = 4

/** Default review (spaced-repetition) property names (issue #57; configurable). */
export const DEFAULT_REVIEWED_DATE_PROPERTY = 'last_reviewed'
export const DEFAULT_REVIEW_INTERVAL_PROPERTY = 'review_interval'
export const DEFAULT_REVIEW_COUNT_PROPERTY = 'review_count'
/** Fallback review interval (days) when a note has no `review_interval`. */
export const DEFAULT_REVIEW_INTERVAL_DAYS = 30

/** Default "soon" threshold (days) for the due-countdown color ramp (issue #62). */
export const DEFAULT_DUE_SOON_THRESHOLD_DAYS = 7

/** Archive grace period (days); 0 = archive on the trigger transition itself. */
export const DEFAULT_ARCHIVE_GRACE_DAYS = 0

/**
 * Multi-value GTD contexts list property (e.g. `@work`, `@home`). A single
 * GLOBAL setting, intentionally not per-type — GTD contexts are cross-cutting.
 */
export const DEFAULT_CONTEXTS_PROPERTY = 'contexts'

/** Default link-property names per relationship role (configurable per note type). */
export const DEFAULT_PARENT_PROPERTY = 'parent'
export const DEFAULT_CHILD_PROPERTY = 'children'
export const DEFAULT_SIBLING_PROPERTY = 'siblings'

/** Default momentjs date format used when writing scheduling dates to notes. */
export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD'

/** Default first day of the calendar week (0 = Sunday … 6 = Saturday). Monday. */
export const DEFAULT_FIRST_DAY_OF_WEEK = 1

/** Sentinel column id for cards with a missing/invalid status value. */
export const UNMAPPED_COLUMN_ID = '__unmapped__'

/** Sentinel swimlane id collecting cards with a missing grouping value. */
export const UNGROUPED_LANE_ID = '__ungrouped__'

/** Starter Kit plugin id we feature-detect for config auto-population. */
export const STARTER_KIT_PLUGIN_ID = 'obsidian-starter-kit'

/** Templater plugin id we feature-detect for template application (issue #46). */
export const TEMPLATER_PLUGIN_ID = 'templater-obsidian'

/** Core "Templates" plugin id — the fallback template engine when Templater is absent. */
export const CORE_TEMPLATES_PLUGIN_ID = 'templates'

/**
 * Week Planner mode (issue #172, phase B): the ideal-week properties and
 * the grid defaults. Property names are the vault's Action System names.
 */
export const DEFAULT_TIME_BLOCKS_PROPERTY = 'time_blocks'
export const DEFAULT_PLANNED_MINUTES_PROPERTY = 'minutes_planned_per_week'
export const DEFAULT_TARGET_MINUTES_PROPERTY = 'minutes_per_week'
/** Weekly alarm (issue #172, phase C): tracked minutes above it flag the week. */
export const DEFAULT_ALARM_MINUTES_PROPERTY = 'minutes_alarm_per_week'
/** Visible grid hours (0..24) — the full day by default. */
export const DEFAULT_WEEK_GRID_START_HOUR = 0
export const DEFAULT_WEEK_GRID_END_HOUR = 24
/** Work band: 09:00–17:00 on Monday..Friday (Monday-first indexes). */
export const DEFAULT_WEEK_WORK_START_MINUTES = 540
export const DEFAULT_WEEK_WORK_END_MINUTES = 1020
export const DEFAULT_WEEK_WORK_DAYS: readonly number[] = [0, 1, 2, 3, 4]
/** Length of a block created by a click, and the vertical scale. */
export const DEFAULT_WEEK_BLOCK_MINUTES = 60
export const DEFAULT_WEEK_PIXELS_PER_HOUR = 48
