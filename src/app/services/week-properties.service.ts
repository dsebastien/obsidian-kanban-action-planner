import type { NoteType } from '../domain/note-type'

/** The four ideal-week / budget property names resolved for one note type. */
export interface WeekProperties {
    timeBlocks: string
    plannedMinutes: string
    targetMinutes: string
    alarmMinutes: string
}

/**
 * The ideal-week properties for a note type (issue #172, phase C): each
 * per-type override wins when non-blank, else the global default.
 * `undefined` (untyped note) = globals. Mirrors `trackingPropertiesForType`.
 */
export function weekPropertiesForType(
    settings: {
        defaultTimeBlocksProperty: string
        defaultPlannedMinutesProperty: string
        defaultTargetMinutesProperty: string
        defaultAlarmMinutesProperty: string
    },
    noteType: Pick<NoteType, 'weekPlanner'> | undefined
): WeekProperties {
    const override = noteType?.weekPlanner
    const pick = (value: string | undefined, fallback: string): string =>
        value && value.trim() !== '' ? value.trim() : fallback
    return {
        timeBlocks: pick(override?.timeBlocksProperty, settings.defaultTimeBlocksProperty),
        plannedMinutes: pick(
            override?.plannedMinutesProperty,
            settings.defaultPlannedMinutesProperty
        ),
        targetMinutes: pick(override?.targetMinutesProperty, settings.defaultTargetMinutesProperty),
        alarmMinutes: pick(override?.alarmMinutesProperty, settings.defaultAlarmMinutesProperty)
    }
}
