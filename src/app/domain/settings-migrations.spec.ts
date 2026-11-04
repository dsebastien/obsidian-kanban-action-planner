import { describe, expect, it } from 'bun:test'
import {
    migrateCalendarDateSeeds,
    migrateSettings,
    migrateTrackingDefaults
} from './settings-migrations'
import type { MigratableSettings, MigratableTrackingDefaults } from './settings-migrations'

const settingsWith = (
    calendar: Partial<MigratableSettings['noteTypes'][number]['calendar']>,
    schemaVersion = 1,
    tracking: MigratableTrackingDefaults = {
        defaultDurationProperty: 'duration',
        defaultTotalDurationProperty: 'total_duration'
    }
): MigratableSettings & MigratableTrackingDefaults => ({
    ...tracking,
    schemaVersion,
    noteTypes: [
        {
            calendar: {
                scheduledDateProperty: 'date_scheduled',
                dueDateProperty: 'date_due',
                dateFormat: 'YYYY-MM-DD',
                ...calendar
            }
        }
    ]
})

describe('migrateCalendarDateSeeds (issue #201)', () => {
    it('clears seeds that are still the built-in defaults', () => {
        expect(migrateCalendarDateSeeds(settingsWith({})).noteTypes[0]?.calendar).toEqual({
            scheduledDateProperty: '',
            dueDateProperty: '',
            dateFormat: ''
        })
    })

    it('keeps a value that is not the built-in default (a deliberate override)', () => {
        const result = migrateCalendarDateSeeds(
            settingsWith({ scheduledDateProperty: 'start_on', dueDateProperty: 'deadline' })
        )
        expect(result.noteTypes[0]?.calendar.scheduledDateProperty).toBe('start_on')
        expect(result.noteTypes[0]?.calendar.dueDateProperty).toBe('deadline')
        // The untouched field is still a seed and still goes.
        expect(result.noteTypes[0]?.calendar.dateFormat).toBe('')
    })

    it('leaves an already-blank field blank', () => {
        expect(
            migrateCalendarDateSeeds(settingsWith({ dueDateProperty: '' })).noteTypes[0]?.calendar
                .dueDateProperty
        ).toBe('')
    })

    it('does not mutate the input', () => {
        const input = settingsWith({})
        migrateCalendarDateSeeds(input)
        expect(input.noteTypes[0]?.calendar.dueDateProperty).toBe('date_due')
    })

    it('handles settings with no note types', () => {
        expect(migrateCalendarDateSeeds({ schemaVersion: 1, noteTypes: [] }).noteTypes).toEqual([])
    })
})

describe('migrateTrackingDefaults (issue #232)', () => {
    it('moves the old fresh-install defaults to the Starter Kit names', () => {
        const result = migrateTrackingDefaults({
            defaultDurationProperty: 'duration',
            defaultTotalDurationProperty: 'total_duration'
        })
        expect(result.defaultDurationProperty).toBe('time_spent')
        expect(result.defaultTotalDurationProperty).toBe('total_time_spent')
    })

    it('keeps any other value (a deliberate choice), field by field', () => {
        const result = migrateTrackingDefaults({
            defaultDurationProperty: 'minutes_tracked',
            defaultTotalDurationProperty: 'total_duration'
        })
        expect(result.defaultDurationProperty).toBe('minutes_tracked')
        expect(result.defaultTotalDurationProperty).toBe('total_time_spent')
    })
})

describe('migrateSettings', () => {
    it('runs the v1 migration and stamps the target version', () => {
        const result = migrateSettings(settingsWith({}), 2)
        expect(result.schemaVersion).toBe(2)
        expect(result.noteTypes[0]?.calendar.dueDateProperty).toBe('')
        // The v2 → v3 step is beyond the target: not run.
        expect(result.defaultDurationProperty).toBe('duration')
    })

    it('runs every step up to the target', () => {
        const result = migrateSettings(settingsWith({}), 3)
        expect(result.schemaVersion).toBe(3)
        expect(result.noteTypes[0]?.calendar.dueDateProperty).toBe('')
        expect(result.defaultDurationProperty).toBe('time_spent')
        expect(result.defaultTotalDurationProperty).toBe('total_time_spent')
    })

    it('runs only the v2 → v3 step on v2 settings', () => {
        const result = migrateSettings(settingsWith({ dueDateProperty: 'date_due' }, 2), 3)
        expect(result.noteTypes[0]?.calendar.dueDateProperty).toBe('date_due')
        expect(result.defaultDurationProperty).toBe('time_spent')
    })

    it('leaves settings already at the target version untouched', () => {
        const current = settingsWith({ dueDateProperty: 'date_due' }, 2)
        const result = migrateSettings(current, 2)
        expect(result).toBe(current)
        expect(result.noteTypes[0]?.calendar.dueDateProperty).toBe('date_due')
    })

    it('returns a NEW object when it migrated, so the caller can detect the change', () => {
        const current = settingsWith({}, 1)
        expect(migrateSettings(current, 2)).not.toBe(current)
    })
})
