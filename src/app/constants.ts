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
/** Days a note is expected to take (drives the timeline's bar length). */
export const DEFAULT_ESTIMATE_PROPERTY = 'estimate'
/** Minutes one work day represents (minute-estimate → days conversion). */
export const DEFAULT_MINUTES_PER_DAY = 480
/** Milestone list entries (`<date> [label]`) rendered as timeline diamonds. */
export const DEFAULT_MILESTONES_PROPERTY = 'milestones'
/** Completion percentage 0–100 (drives the WBS progress bars; issue #76). */
export const DEFAULT_PROGRESS_PROPERTY = 'progress'

/** Default review (spaced-repetition) property names (issue #57; configurable). */
export const DEFAULT_REVIEWED_DATE_PROPERTY = 'last_reviewed'
export const DEFAULT_REVIEW_INTERVAL_PROPERTY = 'review_interval'
export const DEFAULT_REVIEW_COUNT_PROPERTY = 'review_count'
/** Fallback review interval (days) when a note has no `review_interval`. */
export const DEFAULT_REVIEW_INTERVAL_DAYS = 30

/** Default "soon" threshold (days) for the due-countdown color ramp (issue #62). */
export const DEFAULT_DUE_SOON_THRESHOLD_DAYS = 7

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
