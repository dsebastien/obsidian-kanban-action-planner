import { z } from 'zod'
import { noteTypeSchema } from '../domain/note-type'
import {
    DEFAULT_BLOCKED_BY_PROPERTY,
    DEFAULT_DATE_FORMAT,
    DEFAULT_DUE_DATE_PROPERTY,
    DEFAULT_DUE_SOON_THRESHOLD_DAYS,
    DEFAULT_FIRST_DAY_OF_WEEK,
    DEFAULT_ORDER_PROPERTY,
    DEFAULT_REVIEW_COUNT_PROPERTY,
    DEFAULT_REVIEW_INTERVAL_DAYS,
    DEFAULT_REVIEW_INTERVAL_PROPERTY,
    DEFAULT_REVIEWED_DATE_PROPERTY,
    DEFAULT_SCHEDULED_DATE_PROPERTY,
    DEFAULT_STATUS_PROPERTY
} from '../constants'

/** Current settings schema version; bump when the shape changes (migrations). */
const SETTINGS_SCHEMA_VERSION = 1

/**
 * Plugin settings.
 *
 * Holds global default property names (used when a note type/view does not
 * override them) and the local note-type store. The note-type store is the local
 * snapshot/override layer: empty until a board is configured or mirrored from
 * the Starter Kit. Validated with {@link pluginSettingsSchema} on load.
 */
export const pluginSettingsSchema = z.object({
    schemaVersion: z.number(),
    /** Global default frontmatter property names. */
    defaultStatusProperty: z.string(),
    defaultOrderProperty: z.string(),
    defaultBlockedByProperty: z.string(),
    defaultScheduledDateProperty: z.string(),
    defaultDueDateProperty: z.string(),
    /** Review (spaced-repetition) property names (issue #57). */
    reviewedDateProperty: z.string(),
    reviewIntervalProperty: z.string(),
    reviewCountProperty: z.string(),
    /** Fallback review interval (days) when a note has no `review_interval`. */
    defaultReviewIntervalDays: z.number().int().positive(),
    /** Default momentjs format for scheduling dates written to notes. */
    defaultDateFormat: z.string(),
    /** First day of the calendar week (0 = Sunday … 6 = Saturday). */
    firstDayOfWeek: z.number().int().min(0).max(6),
    /** How card property chips are styled: `minimal` (no fills) / `tinted` / `rail`. */
    cardChipStyle: z.enum(['minimal', 'tinted', 'rail']),
    /** "Soon" threshold (days) for the due-countdown color ramp (issue #62). */
    dueSoonThresholdDays: z.number().int().positive(),
    /** Where the due-countdown badge renders: title row / chip / corner / footer. */
    dueCountdownStyle: z.enum(['title', 'chip', 'corner', 'footer']),
    /**
     * Global default status values (columns) used when neither the view nor a
     * Starter Kit note type defines them. Order is the column order.
     */
    defaultStatuses: z.array(z.string()),
    /** Local noteType store (mirror snapshot + local noteTypes + overrides). */
    noteTypes: z.array(noteTypeSchema)
})

export type PluginSettings = z.infer<typeof pluginSettingsSchema>

/**
 * How much of an open board to refresh after a settings change (issue #67), so a
 * purely cosmetic change applies instantly instead of running the heavy full
 * re-derivation (note-type recognition + relationships + search index, ~seconds
 * on large boards):
 * - `chrome` — CSS chrome only (chip style); a class toggle, no re-render.
 * - `cards` — re-derive each card's display + re-render (due countdown position /
 *   "soon" threshold); skips relationships, search, note-type recognition.
 * - `full` — full re-resolution (property names, note types, statuses, swimlanes).
 */
export type SettingsRefreshScope = 'chrome' | 'cards' | 'full'

export const DEFAULT_SETTINGS: PluginSettings = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    defaultStatusProperty: DEFAULT_STATUS_PROPERTY,
    defaultOrderProperty: DEFAULT_ORDER_PROPERTY,
    defaultBlockedByProperty: DEFAULT_BLOCKED_BY_PROPERTY,
    defaultScheduledDateProperty: DEFAULT_SCHEDULED_DATE_PROPERTY,
    defaultDueDateProperty: DEFAULT_DUE_DATE_PROPERTY,
    reviewedDateProperty: DEFAULT_REVIEWED_DATE_PROPERTY,
    reviewIntervalProperty: DEFAULT_REVIEW_INTERVAL_PROPERTY,
    reviewCountProperty: DEFAULT_REVIEW_COUNT_PROPERTY,
    defaultReviewIntervalDays: DEFAULT_REVIEW_INTERVAL_DAYS,
    defaultDateFormat: DEFAULT_DATE_FORMAT,
    firstDayOfWeek: DEFAULT_FIRST_DAY_OF_WEEK,
    cardChipStyle: 'minimal',
    dueSoonThresholdDays: DEFAULT_DUE_SOON_THRESHOLD_DAYS,
    dueCountdownStyle: 'title',
    defaultStatuses: [],
    noteTypes: []
}
