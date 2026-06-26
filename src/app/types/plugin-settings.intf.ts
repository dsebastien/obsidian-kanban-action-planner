import { z } from 'zod'
import { profileSchema } from '../domain/profile'
import {
    DEFAULT_BLOCKED_BY_PROPERTY,
    DEFAULT_DATE_FORMAT,
    DEFAULT_DUE_DATE_PROPERTY,
    DEFAULT_ORDER_PROPERTY,
    DEFAULT_SCHEDULED_DATE_PROPERTY,
    DEFAULT_STATUS_PROPERTY
} from '../constants'

/** Current settings schema version; bump when the shape changes (migrations). */
export const SETTINGS_SCHEMA_VERSION = 1

/**
 * Plugin settings.
 *
 * Holds global default property names (used when a profile/view does not
 * override them) and the local profile store. The profile store is the local
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
    /** Default momentjs format for scheduling dates written to notes. */
    defaultDateFormat: z.string(),
    /**
     * Global default status values (columns) used when neither the view nor a
     * Starter Kit note type defines them. Order is the column order.
     */
    defaultStatuses: z.array(z.string()),
    /** Local profile store (mirror snapshot + local profiles + overrides). */
    profiles: z.array(profileSchema)
})

export type PluginSettings = z.infer<typeof pluginSettingsSchema>

export const DEFAULT_SETTINGS: PluginSettings = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    defaultStatusProperty: DEFAULT_STATUS_PROPERTY,
    defaultOrderProperty: DEFAULT_ORDER_PROPERTY,
    defaultBlockedByProperty: DEFAULT_BLOCKED_BY_PROPERTY,
    defaultScheduledDateProperty: DEFAULT_SCHEDULED_DATE_PROPERTY,
    defaultDueDateProperty: DEFAULT_DUE_DATE_PROPERTY,
    defaultDateFormat: DEFAULT_DATE_FORMAT,
    defaultStatuses: [],
    profiles: []
}
