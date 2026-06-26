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
export const CSS_PREFIX = 'kap-'

/** Default frontmatter property names (configurable in settings / per view). */
export const DEFAULT_STATUS_PROPERTY = 'status'
export const DEFAULT_ORDER_PROPERTY = 'manual_order'
export const DEFAULT_BLOCKED_BY_PROPERTY = 'blocked_by'
export const DEFAULT_SCHEDULED_DATE_PROPERTY = 'date_scheduled'
export const DEFAULT_DUE_DATE_PROPERTY = 'date_due'

/** Default link-property names per relationship role (configurable per profile). */
export const DEFAULT_PARENT_PROPERTY = 'parent'
export const DEFAULT_CHILD_PROPERTY = 'children'
export const DEFAULT_SIBLING_PROPERTY = 'siblings'

/** Default momentjs date format used when writing scheduling dates to notes. */
export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD'

/** Sentinel column id for cards with a missing/invalid status value. */
export const UNMAPPED_COLUMN_ID = '__unmapped__'

/** Sentinel swimlane id collecting cards with a missing grouping value. */
export const UNGROUPED_LANE_ID = '__ungrouped__'

/** Starter Kit plugin id we feature-detect for config auto-population. */
export const STARTER_KIT_PLUGIN_ID = 'obsidian-starter-kit'
