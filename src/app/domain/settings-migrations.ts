import {
    DEFAULT_DATE_FORMAT,
    DEFAULT_DUE_DATE_PROPERTY,
    DEFAULT_SCHEDULED_DATE_PROPERTY
} from '../constants'

/**
 * Settings migrations: pure reshapes of already-parsed settings, keyed by the
 * `schemaVersion` they upgrade FROM. Kept out of the plugin class so each one
 * is unit-testable against a literal, and so the sequence reads as a list.
 */

/** The `calendar` block a note type carries, as far as a migration cares. */
interface MigratableNoteType {
    calendar: {
        scheduledDateProperty: string
        dueDateProperty: string
        dateFormat: string
    }
}

/** The settings shape a migration touches. */
export interface MigratableSettings {
    schemaVersion: number
    noteTypes: MigratableNoteType[]
}

/**
 * v1 → v2 (issue #201). `createDefaultNoteType` used to SEED a note type's
 * calendar date properties (and date format) with the global defaults of the
 * moment. Nothing ever edited them — there was no UI for them — yet
 * `resolveScheduledDateProperty` / `resolveDueDateProperty` read them with `??`,
 * so the frozen snapshot counted as a deliberate per-type override and changing
 * the global setting afterwards had no effect on any board (the timeline, the
 * calendar, and every drag that writes a date).
 *
 * Empty now means "inherit", so the seeds are cleared. Only values that are
 * still EXACTLY the built-in defaults are cleared: those could only have come
 * from the seed. Anything else is a hand edit to `data.json` and is left alone.
 */
export function migrateCalendarDateSeeds<T extends MigratableSettings>(settings: T): T {
    const blankIfDefault = (value: string, builtIn: string): string =>
        value === builtIn ? '' : value
    return {
        ...settings,
        noteTypes: settings.noteTypes.map((noteType) => ({
            ...noteType,
            calendar: {
                ...noteType.calendar,
                scheduledDateProperty: blankIfDefault(
                    noteType.calendar.scheduledDateProperty,
                    DEFAULT_SCHEDULED_DATE_PROPERTY
                ),
                dueDateProperty: blankIfDefault(
                    noteType.calendar.dueDateProperty,
                    DEFAULT_DUE_DATE_PROPERTY
                ),
                dateFormat: blankIfDefault(noteType.calendar.dateFormat, DEFAULT_DATE_FORMAT)
            }
        }))
    }
}

/**
 * Run every migration between the stored `schemaVersion` and `targetVersion`,
 * in order, and stamp the result. Already-current settings are returned as-is.
 */
export function migrateSettings<T extends MigratableSettings>(
    settings: T,
    targetVersion: number
): T {
    let current = settings
    if (current.schemaVersion < 2) current = migrateCalendarDateSeeds(current)
    return current.schemaVersion === targetVersion
        ? current
        : { ...current, schemaVersion: targetVersion }
}
